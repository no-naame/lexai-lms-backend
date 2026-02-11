import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { createOrder, verifyPaymentSignature } from "../../lib/razorpay.js";
import { enrollSubscriber } from "../../lib/access.js";

export default async function paymentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ─── POST /payments/create-order ─────────────────────────────
  app.post(
    "/create-order",
    {
      schema: {
        tags: ["Payments"],
        summary: "Create a Razorpay order",
        description:
          "Creates a Razorpay order for platform access. Returns order_id and key_id for frontend checkout widget.",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "Order created",
            type: "object",
            properties: {
              orderId: { type: "string" },
              amount: { type: "integer" },
              currency: { type: "string" },
              keyId: { type: "string" },
            },
          },
          400: {
            description: "Already has access",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.currentUser!.userId;

      // Check if already premium
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true },
      });

      if (user?.isPremium) {
        return reply
          .status(400)
          .send({ error: "You already have premium access" });
      }

      // Check if user is a verified org member
      const membership = await app.prisma.organizationMember.findFirst({
        where: {
          userId,
          isActive: true,
          isVerified: true,
          organization: { isActive: true },
        },
      });

      if (membership) {
        return reply
          .status(400)
          .send({ error: "You already have access through your institution" });
      }

      const amount = parseInt(process.env.PLATFORM_PRICE || "49900", 10);
      const receipt = `receipt_${userId}_${Date.now()}`;

      const order = await createOrder(amount, "INR", receipt, { userId });

      await app.prisma.payment.create({
        data: {
          userId,
          razorpayOrderId: order.id,
          amount,
          status: "created",
          receipt,
        },
      });

      return reply.send({
        orderId: order.id,
        amount,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
      });
    }
  );

  // ─── POST /payments/verify ──────────────────────────────────
  app.post(
    "/verify",
    {
      schema: {
        tags: ["Payments"],
        summary: "Verify Razorpay payment",
        description:
          "Verifies the Razorpay payment signature after checkout. On success, grants premium access and enrolls user in all courses.",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: [
            "razorpay_order_id",
            "razorpay_payment_id",
            "razorpay_signature",
          ],
          properties: {
            razorpay_order_id: { type: "string" },
            razorpay_payment_id: { type: "string" },
            razorpay_signature: { type: "string" },
          },
        },
        response: {
          200: {
            description: "Payment verified",
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          400: {
            description: "Verification failed",
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            description: "Payment not found",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.currentUser!.userId;
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
        request.body as {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        };

      // Look up payment
      const payment = await app.prisma.payment.findUnique({
        where: { razorpayOrderId: razorpay_order_id },
      });

      if (!payment || payment.userId !== userId) {
        return reply.status(404).send({ error: "Payment not found" });
      }

      // Idempotent: already paid
      if (payment.status === "paid") {
        return reply.send({
          success: true,
          message: "Payment already verified",
        });
      }

      // Verify signature
      const isValid = verifyPaymentSignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );

      if (!isValid) {
        return reply
          .status(400)
          .send({ error: "Payment verification failed" });
      }

      // Update payment and user in a transaction
      await app.prisma.$transaction([
        app.prisma.payment.update({
          where: { razorpayOrderId: razorpay_order_id },
          data: {
            status: "paid",
            razorpayPaymentId: razorpay_payment_id,
          },
        }),
        app.prisma.user.update({
          where: { id: userId },
          data: { isPremium: true },
        }),
      ]);

      // Enroll in all published courses
      await enrollSubscriber(app.prisma, userId);

      return reply.send({
        success: true,
        message: "Payment verified and access granted",
      });
    }
  );

  // ─── GET /payments/status ───────────────────────────────────
  app.get(
    "/status",
    {
      schema: {
        tags: ["Payments"],
        summary: "Get payment/access status",
        description:
          "Returns the user's access status: premium (paid), institution (B2B), or none. Frontend uses this to decide whether to show payment UI.",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "Access status",
            type: "object",
            properties: {
              hasAccess: { type: "boolean" },
              accessType: {
                type: "string",
                nullable: true,
                enum: ["premium", "institution"],
              },
              isPremium: { type: "boolean" },
              organization: { type: "string", nullable: true },
              latestPayment: {
                type: "object",
                nullable: true,
                properties: {
                  status: { type: "string" },
                  amount: { type: "integer" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.currentUser!.userId;

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true },
      });

      // Check institutional access
      const membership = await app.prisma.organizationMember.findFirst({
        where: {
          userId,
          isActive: true,
          isVerified: true,
          organization: { isActive: true },
        },
        include: {
          organization: { select: { name: true } },
        },
      });

      // Latest payment
      const latestPayment = await app.prisma.payment.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { status: true, amount: true, createdAt: true },
      });

      const isPremium = user?.isPremium ?? false;
      const hasInstitution = !!membership;

      let accessType: "premium" | "institution" | null = null;
      if (isPremium) {
        accessType = "premium";
      } else if (hasInstitution) {
        accessType = "institution";
      }

      return reply.send({
        hasAccess: isPremium || hasInstitution,
        accessType,
        isPremium,
        organization: membership?.organization?.name ?? null,
        latestPayment: latestPayment
          ? {
              status: latestPayment.status,
              amount: latestPayment.amount,
              createdAt: latestPayment.createdAt,
            }
          : null,
      });
    }
  );
}
