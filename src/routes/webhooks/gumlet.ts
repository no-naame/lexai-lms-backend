import type { FastifyInstance } from "fastify";

export default async function gumletWebhookRoutes(app: FastifyInstance) {
  // POST /webhooks/gumlet — Gumlet sends video processing status updates
  app.post(
    "/gumlet",
    {
      schema: {
        tags: ["Webhooks"],
        summary: "Gumlet webhook",
        description:
          "Receives video processing status events from Gumlet. Authenticated via x-gumlet-token header, not via cookies.",
        response: {
          200: {
            description: "Webhook received",
            type: "object",
            properties: {
              received: { type: "boolean" },
            },
          },
          401: {
            description: "Invalid webhook token",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      // Verify webhook authenticity
      const webhookSecret = process.env.GUMLET_WEBHOOK_SECRET;
      const token = request.headers["x-gumlet-token"];

      if (!webhookSecret || token !== webhookSecret) {
        return reply.status(401).send({ error: "Invalid webhook token" });
      }

      const payload = request.body as {
        event?: string;
        asset_id?: string;
        output?: {
          playback_url?: string;
          thumbnail?: string[];
          duration?: number;
        };
      };

      const { event, asset_id: gumletAssetId } = payload;

      if (!event || !gumletAssetId) {
        return reply.send({ received: true });
      }

      // Look up our VideoAsset by gumletAssetId
      const asset = await app.prisma.videoAsset.findUnique({
        where: { gumletAssetId },
      });

      if (!asset) {
        // We don't have a record for this asset — acknowledge anyway
        return reply.send({ received: true });
      }

      if (event === "video.status.ready") {
        const playbackUrl = payload.output?.playback_url ?? null;
        const thumbnailUrl = payload.output?.thumbnail?.[0] ?? null;
        const duration = payload.output?.duration
          ? Math.round(payload.output.duration)
          : null;

        await app.prisma.videoAsset.update({
          where: { gumletAssetId },
          data: {
            status: "ready",
            playbackUrl,
            thumbnailUrl,
            duration,
          },
        });

        // Update the target entity with the playback URL
        if (asset.targetType === "course_intro" && playbackUrl) {
          await app.prisma.course.update({
            where: { id: asset.targetId },
            data: { introVideoUrl: playbackUrl },
          });
        } else if (asset.targetType === "lesson") {
          const updateData: Record<string, unknown> = {};
          if (playbackUrl) updateData.videoUrl = playbackUrl;
          if (duration !== null) updateData.duration = duration;

          if (Object.keys(updateData).length > 0) {
            await app.prisma.lesson.update({
              where: { id: asset.targetId },
              data: updateData,
            });
          }
        }
      } else if (event === "video.status.errored") {
        await app.prisma.videoAsset.update({
          where: { gumletAssetId },
          data: { status: "errored" },
        });
      } else if (
        event === "video.status.processed" ||
        event === "video.status.stream_ready"
      ) {
        await app.prisma.videoAsset.update({
          where: { gumletAssetId },
          data: { status: "processing" },
        });
      }

      return reply.send({ received: true });
    }
  );
}
