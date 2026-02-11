import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireOrgRole } from "../../hooks/rbac.js";
import { assignCourseSchema } from "../../schemas/organization.js";
import { autoEnrollMember } from "../../lib/access.js";

export default async function institutionCoursesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireOrgRole("ADMIN"));

  // GET /institutions/:orgId/courses - List course access for org
  app.get("/", {
    schema: {
      tags: ["Institutions - Courses"],
      summary: "List course access",
      description: "List all course access assignments for an organization, including both org-level and batch-level assignments.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["orgId"], properties: { orgId: { type: "string" } } },
      response: {
        200: {
          description: "Course access assignments",
          type: "object",
          properties: {
            organizationCourses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  organizationId: { type: "string" },
                  courseId: { type: "string" },
                  course: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, slug: { type: "string" } } },
                },
              },
            },
            batchCourses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  batchId: { type: "string" },
                  courseId: { type: "string" },
                  course: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, slug: { type: "string" } } },
                  batch: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    const [orgAccess, batchAccess] = await Promise.all([
      app.prisma.organizationCourseAccess.findMany({
        where: { organizationId: orgId },
        include: { course: true },
      }),
      app.prisma.batchCourseAccess.findMany({
        where: { batch: { organizationId: orgId } },
        include: {
          course: true,
          batch: { select: { id: true, name: true } },
        },
      }),
    ]);

    return reply.send({
      organizationCourses: orgAccess,
      batchCourses: batchAccess,
    });
  });

  // POST /institutions/:orgId/courses - Assign course to org or batch
  app.post("/", {
    schema: {
      tags: ["Institutions - Courses"],
      summary: "Assign course access",
      description: "Assign course access to an organization or a specific batch. Auto-enrolls all verified active members. If batchId is provided, assigns to the batch; otherwise assigns to the entire org.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["orgId"], properties: { orgId: { type: "string" } } },
      body: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", description: "Course CUID to assign" },
          batchId: { type: "string", description: "Optional — if provided, assigns to batch instead of org" },
        },
      },
      response: {
        201: { description: "Course access assigned", type: "object", properties: { success: { type: "boolean", example: true } } },
        400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
        404: { description: "Course or batch not found", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const parsed = assignCourseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { courseId, batchId } = parsed.data;

    // Verify course exists
    const course = await app.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      return reply.status(404).send({ error: "Course not found" });
    }

    if (batchId) {
      // Batch-level access
      const batch = await app.prisma.batch.findFirst({
        where: { id: batchId, organizationId: orgId },
      });
      if (!batch) {
        return reply.status(404).send({ error: "Batch not found in this organization" });
      }

      await app.prisma.batchCourseAccess.upsert({
        where: {
          batchId_courseId: { batchId, courseId },
        },
        create: { batchId, courseId },
        update: {},
      });

      // Auto-enroll all verified members in this batch
      const members = await app.prisma.organizationMember.findMany({
        where: { batchId, isVerified: true, isActive: true },
      });
      for (const member of members) {
        await autoEnrollMember(app.prisma, member.userId, orgId, batchId);
      }
    } else {
      // Org-level access
      await app.prisma.organizationCourseAccess.upsert({
        where: {
          organizationId_courseId: { organizationId: orgId, courseId },
        },
        create: { organizationId: orgId, courseId },
        update: {},
      });

      // Auto-enroll all verified members in this org
      const members = await app.prisma.organizationMember.findMany({
        where: { organizationId: orgId, isVerified: true, isActive: true },
      });
      for (const member of members) {
        await autoEnrollMember(app.prisma, member.userId, orgId, member.batchId);
      }
    }

    return reply.status(201).send({ success: true });
  });

  // DELETE /institutions/:orgId/courses/:courseId - Remove course access
  app.delete("/:courseId", {
    schema: {
      tags: ["Institutions - Courses"],
      summary: "Remove course access",
      description: "Remove course access from an organization or batch. Does NOT unenroll existing students — their CourseEnrollment records remain.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["orgId", "courseId"],
        properties: {
          orgId: { type: "string" },
          courseId: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          batchId: { type: "string", description: "If provided, removes batch-level access only" },
        },
      },
      response: {
        200: { description: "Course access removed", type: "object", properties: { success: { type: "boolean", example: true } } },
      },
    },
  }, async (request, reply) => {
    const { orgId, courseId } = request.params as {
      orgId: string;
      courseId: string;
    };
    const { batchId } = request.query as { batchId?: string };

    if (batchId) {
      await app.prisma.batchCourseAccess.deleteMany({
        where: { batchId, courseId },
      });
    } else {
      await app.prisma.organizationCourseAccess.deleteMany({
        where: { organizationId: orgId, courseId },
      });
    }

    return reply.send({ success: true });
  });
}
