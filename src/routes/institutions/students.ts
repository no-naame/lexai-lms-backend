import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireOrgRole } from "../../hooks/rbac.js";
import { studentQuerySchema } from "../../schemas/student.js";

export default async function institutionStudentsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireOrgRole("ADMIN"));

  // GET /institutions/:orgId/students - List student records
  app.get("/", {
    schema: {
      tags: ["Institutions - Students"],
      summary: "List student records",
      description: "List student records for an organization with pagination, search, and filters. Requires org ADMIN role or PLATFORM_ADMIN.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["orgId"], properties: { orgId: { type: "string", description: "Organization CUID" } } },
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", default: 1, description: "Page number" },
          limit: { type: "integer", default: 20, description: "Items per page (1-100)" },
          search: { type: "string", description: "Search by name, email, or enrollment ID" },
          batchId: { type: "string", description: "Filter by batch ID" },
          claimed: { type: "string", enum: ["true", "false"], description: "Filter by claimed status" },
        },
      },
      response: {
        400: {
          description: "Validation error",
          type: "object",
          properties: { error: { type: "string" }, details: { type: "object", additionalProperties: true } },
        },
        200: {
          description: "Paginated student records",
          type: "object",
          properties: {
            students: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  organizationId: { type: "string" },
                  email: { type: "string", example: "student@acme.edu" },
                  name: { type: "string", nullable: true },
                  enrollmentId: { type: "string", example: "ACM-2024-001" },
                  batchId: { type: "string", nullable: true },
                  isClaimed: { type: "boolean" },
                  claimedByUserId: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                  batch: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" } } },
                  claimedBy: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } } },
                },
              },
            },
            pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = studentQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { page, limit, search, batchId, claimed } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { organizationId: orgId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { enrollmentId: { contains: search, mode: "insensitive" } },
      ];
    }
    if (batchId) where.batchId = batchId;
    if (claimed !== undefined) where.isClaimed = claimed === "true";

    const [records, total] = await Promise.all([
      app.prisma.studentRecord.findMany({
        where,
        include: {
          batch: { select: { id: true, name: true } },
          claimedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      app.prisma.studentRecord.count({ where }),
    ]);

    return reply.send({
      students: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // DELETE /institutions/:orgId/students/:recordId - Remove student record
  app.delete("/:recordId", {
    schema: {
      tags: ["Institutions - Students"],
      summary: "Delete a student record",
      description: "Delete a student record. If the record was claimed, also removes the org membership and institutional course enrollments for that user.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["orgId", "recordId"],
        properties: {
          orgId: { type: "string", description: "Organization CUID" },
          recordId: { type: "string", description: "StudentRecord CUID" },
        },
      },
      response: {
        200: { description: "Student record deleted", type: "object", properties: { success: { type: "boolean", example: true } } },
        404: { description: "Student record not found in this organization", type: "object", properties: { error: { type: "string", example: "Student record not found" } } },
      },
    },
  }, async (request, reply) => {
    const { orgId, recordId } = request.params as {
      orgId: string;
      recordId: string;
    };

    const record = await app.prisma.studentRecord.findFirst({
      where: { id: recordId, organizationId: orgId },
    });

    if (!record) {
      return reply.status(404).send({ error: "Student record not found" });
    }

    // If claimed, also remove the org membership
    if (record.isClaimed && record.claimedByUserId) {
      await app.prisma.organizationMember.deleteMany({
        where: {
          userId: record.claimedByUserId,
          organizationId: orgId,
        },
      });

      // Remove institutional course enrollments
      await app.prisma.courseEnrollment.deleteMany({
        where: {
          userId: record.claimedByUserId,
          accessSource: "INSTITUTION",
        },
      });
    }

    await app.prisma.studentRecord.delete({ where: { id: recordId } });

    return reply.send({ success: true });
  });
}
