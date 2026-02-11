import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireRole } from "../../hooks/rbac.js";
import {
  createUploadUrl,
  getAssetStatus,
  deleteAsset,
} from "../../lib/gumlet.js";

export default async function adminVideoRoutes(app: FastifyInstance) {
  const adminGuard = [authenticate, requireRole("PLATFORM_ADMIN")];

  // POST /admin/videos/upload-url — Request a direct upload URL from Gumlet
  app.post(
    "/upload-url",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Videos"],
        summary: "Get a video upload URL",
        description:
          "Request a direct upload URL from Gumlet. The admin frontend uploads the file directly to the returned URL via PUT. No video data passes through our server.",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["targetType", "targetId"],
          properties: {
            targetType: {
              type: "string",
              enum: ["course_intro", "lesson"],
              description: 'Type of entity this video is for',
            },
            targetId: {
              type: "string",
              description: "The Course or Lesson CUID",
            },
            filename: {
              type: "string",
              description: "Original filename for reference",
            },
          },
        },
        response: {
          200: {
            description: "Upload URL and asset identifiers",
            type: "object",
            properties: {
              uploadUrl: { type: "string" },
              assetId: { type: "string", description: "Our internal VideoAsset CUID" },
              gumletAssetId: { type: "string" },
            },
          },
          400: {
            description: "Validation error",
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            description: "Target entity not found",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { targetType, targetId, filename } = request.body as {
        targetType: "course_intro" | "lesson";
        targetId: string;
        filename?: string;
      };

      // Validate that the target entity exists
      if (targetType === "course_intro") {
        const course = await app.prisma.course.findUnique({
          where: { id: targetId },
        });
        if (!course) {
          return reply.status(404).send({ error: "Course not found" });
        }
      } else {
        const lesson = await app.prisma.lesson.findUnique({
          where: { id: targetId },
        });
        if (!lesson) {
          return reply.status(404).send({ error: "Lesson not found" });
        }
      }

      const gumletResponse = await createUploadUrl();

      const videoAsset = await app.prisma.videoAsset.create({
        data: {
          gumletAssetId: gumletResponse.asset_id,
          status: "pending",
          targetType,
          targetId,
          originalFilename: filename ?? null,
        },
      });

      return reply.send({
        uploadUrl: gumletResponse.upload_url,
        assetId: videoAsset.id,
        gumletAssetId: gumletResponse.asset_id,
      });
    }
  );

  // GET /admin/videos/:assetId/status — Check video processing status
  app.get(
    "/:assetId/status",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Videos"],
        summary: "Get video asset status",
        description:
          "Returns the current status of a video asset. If not yet ready/errored, also polls Gumlet for the latest status.",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["assetId"],
          properties: {
            assetId: { type: "string", description: "VideoAsset CUID" },
          },
        },
        response: {
          200: {
            description: "Video asset details",
            type: "object",
            properties: {
              asset: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  gumletAssetId: { type: "string" },
                  status: { type: "string" },
                  playbackUrl: { type: "string", nullable: true },
                  thumbnailUrl: { type: "string", nullable: true },
                  duration: { type: "integer", nullable: true },
                  targetType: { type: "string" },
                  targetId: { type: "string" },
                },
              },
            },
          },
          404: {
            description: "Asset not found",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };

      let asset = await app.prisma.videoAsset.findUnique({
        where: { id: assetId },
      });
      if (!asset) {
        return reply.status(404).send({ error: "Video asset not found" });
      }

      // If not in a terminal state, poll Gumlet for the latest
      if (asset.status !== "ready" && asset.status !== "errored") {
        try {
          const gumletStatus = await getAssetStatus(asset.gumletAssetId);

          const updateData: Record<string, unknown> = {};

          if (gumletStatus.status === "ready") {
            updateData.status = "ready";
            updateData.playbackUrl = gumletStatus.output?.playback_url ?? null;
            updateData.thumbnailUrl =
              gumletStatus.output?.thumbnail?.[0] ?? null;
            updateData.duration = gumletStatus.output?.duration
              ? Math.round(gumletStatus.output.duration)
              : null;
          } else if (gumletStatus.status === "errored") {
            updateData.status = "errored";
          } else if (
            gumletStatus.status === "processing" ||
            gumletStatus.status === "queued"
          ) {
            updateData.status = "processing";
          }

          if (Object.keys(updateData).length > 0) {
            asset = await app.prisma.videoAsset.update({
              where: { id: assetId },
              data: updateData,
            });
          }
        } catch {
          // If Gumlet poll fails, return what we have in DB
        }
      }

      return reply.send({
        asset: {
          id: asset.id,
          gumletAssetId: asset.gumletAssetId,
          status: asset.status,
          playbackUrl: asset.playbackUrl,
          thumbnailUrl: asset.thumbnailUrl,
          duration: asset.duration,
          targetType: asset.targetType,
          targetId: asset.targetId,
        },
      });
    }
  );

  // GET /admin/videos — List all video assets
  app.get(
    "/",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Videos"],
        summary: "List video assets",
        description:
          "List all video assets with optional filters for targetType, targetId, and status. Supports pagination.",
        security: [{ cookieAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            targetType: { type: "string", enum: ["course_intro", "lesson"] },
            targetId: { type: "string" },
            status: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            description: "Paginated video assets",
            type: "object",
            properties: {
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    gumletAssetId: { type: "string" },
                    status: { type: "string" },
                    playbackUrl: { type: "string", nullable: true },
                    thumbnailUrl: { type: "string", nullable: true },
                    duration: { type: "integer", nullable: true },
                    targetType: { type: "string" },
                    targetId: { type: "string" },
                    originalFilename: { type: "string", nullable: true },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
              pagination: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  limit: { type: "integer" },
                  offset: { type: "integer" },
                  hasMore: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { targetType, targetId, status, limit, offset } =
        request.query as {
          targetType?: string;
          targetId?: string;
          status?: string;
          limit?: number;
          offset?: number;
        };

      const take = limit ?? 20;
      const skip = offset ?? 0;

      const where: Record<string, unknown> = {};
      if (targetType) where.targetType = targetType;
      if (targetId) where.targetId = targetId;
      if (status) where.status = status;

      const [assets, total] = await Promise.all([
        app.prisma.videoAsset.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        app.prisma.videoAsset.count({ where }),
      ]);

      return reply.send({
        assets,
        pagination: {
          total,
          limit: take,
          offset: skip,
          hasMore: skip + take < total,
        },
      });
    }
  );

  // DELETE /admin/videos/:assetId — Delete a video asset
  app.delete(
    "/:assetId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Videos"],
        summary: "Delete a video asset",
        description:
          "Deletes the video asset from our DB and from Gumlet (best-effort). Nullifies the playbackUrl on the associated Course or Lesson.",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["assetId"],
          properties: {
            assetId: { type: "string", description: "VideoAsset CUID" },
          },
        },
        response: {
          200: {
            description: "Asset deleted",
            type: "object",
            properties: {
              message: {
                type: "string",
                example: "Video asset deleted",
              },
            },
          },
          404: {
            description: "Asset not found",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };

      const asset = await app.prisma.videoAsset.findUnique({
        where: { id: assetId },
      });
      if (!asset) {
        return reply.status(404).send({ error: "Video asset not found" });
      }

      // Best-effort delete from Gumlet
      try {
        await deleteAsset(asset.gumletAssetId);
      } catch {
        // Gumlet deletion is best-effort
      }

      // Nullify the URL on the target entity
      if (asset.targetType === "course_intro") {
        await app.prisma.course.update({
          where: { id: asset.targetId },
          data: { introVideoUrl: null },
        });
      } else if (asset.targetType === "lesson") {
        await app.prisma.lesson.update({
          where: { id: asset.targetId },
          data: { videoUrl: null },
        });
      }

      await app.prisma.videoAsset.delete({ where: { id: assetId } });

      return reply.send({ message: "Video asset deleted" });
    }
  );
}
