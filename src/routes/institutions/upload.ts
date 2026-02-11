import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { authenticate } from "../../hooks/auth.js";
import { requireOrgRole } from "../../hooks/rbac.js";
import { parseStudentCSV } from "../../lib/csv.js";
import { autoEnrollMember } from "../../lib/access.js";

export default async function institutionUploadRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireOrgRole("ADMIN"));

  // POST /institutions/:orgId/students/upload - Upload CSV of students
  app.post("/upload", {
    schema: {
      tags: ["Institutions - Students"],
      summary: "Upload student CSV",
      description: "Upload a CSV file containing student records. Auto-creates batches and auto-links existing users. If a user with a matching email already exists, they are automatically enrolled. Maximum file size: 5MB. CSV columns: name, email, enrollmentId, batch.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["orgId"], properties: { orgId: { type: "string" } } },
      consumes: ["multipart/form-data"],
      response: {
        200: {
          description: "Upload processed",
          type: "object",
          properties: {
            success: { type: "boolean" },
            stats: {
              type: "object",
              properties: {
                added: { type: "integer", example: 45 },
                updated: { type: "integer", example: 5 },
                alreadyClaimed: { type: "integer", example: 3 },
                autoLinked: { type: "integer", example: 10 },
                totalProcessed: { type: "integer", example: 53 },
                parseErrors: { type: "integer", example: 2 },
              },
            },
            errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  row: { type: "integer" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        400: { description: "No file or no valid records", type: "object", properties: { error: { type: "string" } } },
        404: { description: "Organization not found", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    // Verify org exists
    const org = await app.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      return reply.status(404).send({ error: "Organization not found" });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const csvContent = await file.toBuffer();
    const { valid, errors } = parseStudentCSV(csvContent.toString("utf-8"));

    if (valid.length === 0) {
      return reply.status(400).send({
        error: "No valid records found in CSV",
        parseErrors: errors,
      });
    }

    const stats = { added: 0, updated: 0, alreadyClaimed: 0, autoLinked: 0 };

    for (const row of valid) {
      // Create/find batch if specified
      let batchId: string | null = null;
      if (row.batch) {
        const batch = await app.prisma.batch.upsert({
          where: {
            organizationId_name: {
              organizationId: orgId,
              name: row.batch,
            },
          },
          create: {
            organizationId: orgId,
            name: row.batch,
          },
          update: {},
        });
        batchId = batch.id;
      }

      // Upsert student record
      const existing = await app.prisma.studentRecord.findUnique({
        where: {
          organizationId_email: {
            organizationId: orgId,
            email: row.email,
          },
        },
      });

      if (existing?.isClaimed) {
        stats.alreadyClaimed++;
        continue;
      }

      await app.prisma.studentRecord.upsert({
        where: {
          organizationId_email: {
            organizationId: orgId,
            email: row.email,
          },
        },
        create: {
          organizationId: orgId,
          email: row.email,
          name: row.name,
          enrollmentId: row.enrollmentId,
          batchId,
        },
        update: {
          name: row.name,
          enrollmentId: row.enrollmentId,
          batchId,
        },
      });

      if (existing) {
        stats.updated++;
      } else {
        stats.added++;
      }

      // Auto-link: check if a user with this email already exists
      const existingUser = await app.prisma.user.findUnique({
        where: { email: row.email },
      });

      if (existingUser) {
        // Check if already a member
        const existingMember = await app.prisma.organizationMember.findUnique({
          where: {
            userId_organizationId: {
              userId: existingUser.id,
              organizationId: orgId,
            },
          },
        });

        if (!existingMember) {
          await app.prisma.organizationMember.create({
            data: {
              userId: existingUser.id,
              organizationId: orgId,
              role: "STUDENT",
              enrollmentId: row.enrollmentId,
              batchId,
              isVerified: true,
            },
          });

          await app.prisma.studentRecord.update({
            where: {
              organizationId_email: {
                organizationId: orgId,
                email: row.email,
              },
            },
            data: {
              isClaimed: true,
              claimedByUserId: existingUser.id,
            },
          });

          await autoEnrollMember(app.prisma, existingUser.id, orgId, batchId);
          stats.autoLinked++;
        }
      }
    }

    return reply.send({
      success: true,
      stats: {
        ...stats,
        totalProcessed: valid.length,
        parseErrors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  });
}
