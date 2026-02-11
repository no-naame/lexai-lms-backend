import type { FastifyInstance } from "fastify";
import { verifyWebhookSignatureFn } from "../../lib/razorpay.js";
import { enrollSubscriber } from "../../lib/access.js";

export default async function razorpayWebhookRoutes(app: FastifyInstance) {
  // Override the JSON content type parser for this plugin scope to capture raw body
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const rawString = body as string;
        const json = JSON.parse(rawString);
        // Attach raw body string for signature verification
        (json as any).__rawBody = rawString;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // POST /webhooks/razorpay — Razorpay sends payment status events
  app.post(
    "/razorpay",
    {
      schema: {
        tags: ["Webhooks"],
        summary: "Razorpay webhook",
        description:
          "Receives payment status events from Razorpay (payment.captured, payment.failed). Authenticated via x-razorpay-signature header HMAC verification.",
        response: {
          200: {
            description: "Webhook received",
            type: "object",
            properties: {
              received: { type: "boolean" },
            },
          },
          400: {
            description: "Invalid signature or request",
            type: "object",
            properties: {
              received: { type: "boolean" },
            },
          },
          500: {
            description: "Server configuration error",
            type: "object",
            properties: {
              received: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        app.log.error("RAZORPAY_WEBHOOK_SECRET not configured");
        return reply.status(500).send({ received: false });
      }

      const signature = request.headers["x-razorpay-signature"] as string;
      if (!signature) {
        return reply.status(400).send({ received: false });
      }

      // Get raw body for signature verification
      const rawBody = (request.body as any).__rawBody as string | undefined;
      if (!rawBody) {
        return reply.status(400).send({ received: false });
      }

      let isValid: boolean;
      try {
        isValid = verifyWebhookSignatureFn(rawBody, signature, webhookSecret);
      } catch {
        return reply.status(400).send({ received: false });
      }

      if (!isValid) {
        return reply.status(400).send({ received: false });
      }

      const payload = request.body as {
        event?: string;
        payload?: {
          payment?: {
            entity?: {
              id?: string;
              order_id?: string;
              status?: string;
            };
          };
        };
      };

      const event = payload.event;
      const paymentEntity = payload.payload?.payment?.entity;

      if (!event || !paymentEntity) {
        return reply.send({ received: true });
      }

      if (event === "payment.captured") {
        const orderId = paymentEntity.order_id;
        const paymentId = paymentEntity.id;

        if (!orderId || !paymentId) {
          return reply.send({ received: true });
        }

        // Find payment record
        const payment = await app.prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
        });

        if (!payment) {
          return reply.send({ received: true });
        }

        // Idempotent: already paid
        if (payment.status === "paid") {
          return reply.send({ received: true });
        }

        // Update payment and user
        await app.prisma.$transaction([
          app.prisma.payment.update({
            where: { razorpayOrderId: orderId },
            data: {
              status: "paid",
              razorpayPaymentId: paymentId,
            },
          }),
          app.prisma.user.update({
            where: { id: payment.userId },
            data: { isPremium: true },
          }),
        ]);

        // Enroll in all published courses
        await enrollSubscriber(app.prisma, payment.userId);
      } else if (event === "payment.failed") {
        const orderId = paymentEntity.order_id;

        if (!orderId) {
          return reply.send({ received: true });
        }

        const payment = await app.prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
        });

        if (payment && payment.status !== "paid") {
          await app.prisma.payment.update({
            where: { razorpayOrderId: orderId },
            data: { status: "failed" },
          });
        }
      }

      return reply.send({ received: true });
    }
  );
}
