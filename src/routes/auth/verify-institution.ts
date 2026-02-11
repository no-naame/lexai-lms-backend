import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { verifyInstitutionSchema } from "../../schemas/auth.js";
import { findOrganizationByEmail, findStudentRecord } from "../../lib/domain-check.js";
import { autoEnrollMember } from "../../lib/access.js";

export default async function verifyInstitutionRoutes(app: FastifyInstance) {
  // POST /auth/verify-institution - One-time enrollment ID verification
  app.post(
    "/verify-institution",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Auth - Institution"],
        summary: "Verify institutional affiliation",
        description:
          "Verify the user's affiliation with an institution using their enrollment ID. On success: creates org membership, marks student record as claimed, and auto-enrolls the user in all published institutional courses.",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["enrollmentId"],
          properties: {
            enrollmentId: {
              type: "string",
              example: "ACM-2024-001",
              description: "Enrollment ID provided by the institution",
            },
          },
        },
        response: {
          200: {
            description: "Verified successfully",
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              organization: { type: "string", example: "Acme University" },
              message: {
                type: "string",
                example:
                  "Successfully verified with Acme University. You now have access to your institutional courses.",
              },
            },
          },
          400: {
            description: "Already verified or enrollment ID not found",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Enrollment ID not found. Please check your ID or contact your institution.",
              },
            },
          },
          404: {
            description: "No institution matches user's email domain",
            type: "object",
            properties: { error: { type: "string", example: "No institution found for your email domain" } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = verifyInstitutionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = request.currentUser!.userId;
      const email = request.currentUser!.email;
      const { enrollmentId } = parsed.data;

      // Find matching organization
      const org = await findOrganizationByEmail(app.prisma, email);
      if (!org) {
        return reply.status(404).send({
          error: "No institution found for your email domain",
        });
      }

      // Check if already verified
      const existingMember = await app.prisma.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: org.id,
          },
        },
      });

      if (existingMember?.isVerified) {
        return reply.status(400).send({
          error: "You are already verified with this institution",
        });
      }

      // Find student record matching email AND enrollment ID
      const record = await app.prisma.studentRecord.findFirst({
        where: {
          organizationId: org.id,
          email: email.toLowerCase(),
          enrollmentId,
          isClaimed: false,
        },
      });

      if (!record) {
        return reply.status(400).send({
          error: "Enrollment ID not found. Please check your ID or contact your institution.",
        });
      }

      // Create or update organization membership
      await app.prisma.organizationMember.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: org.id,
          },
        },
        create: {
          userId,
          organizationId: org.id,
          role: "STUDENT",
          enrollmentId: record.enrollmentId,
          batchId: record.batchId,
          isVerified: true,
        },
        update: {
          enrollmentId: record.enrollmentId,
          batchId: record.batchId,
          isVerified: true,
        },
      });

      // Mark student record as claimed
      await app.prisma.studentRecord.update({
        where: { id: record.id },
        data: { isClaimed: true, claimedByUserId: userId },
      });

      // Auto-enroll in org/batch courses
      await autoEnrollMember(app.prisma, userId, org.id, record.batchId);

      return reply.send({
        success: true,
        organization: org.name,
        message: `Successfully verified with ${org.name}. You now have access to your institutional courses.`,
      });
    }
  );

  // GET /auth/institution-status - Check if user needs institution verification
  app.get(
    "/institution-status",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Auth - Institution"],
        summary: "Check institution status",
        description:
          "Check if the current user's email domain matches any registered institution and whether they have completed verification.",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "Institution status",
            type: "object",
            properties: {
              hasInstitution: { type: "boolean", example: true },
              organizationName: { type: "string", example: "Acme University" },
              organizationSlug: { type: "string", example: "acme-university" },
              isVerified: { type: "boolean", example: false },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const email = request.currentUser!.email;

      const org = await findOrganizationByEmail(app.prisma, email);
      if (!org) {
        return reply.send({ hasInstitution: false });
      }

      const membership = await app.prisma.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId: request.currentUser!.userId,
            organizationId: org.id,
          },
        },
      });

      return reply.send({
        hasInstitution: true,
        organizationName: org.name,
        organizationSlug: org.slug,
        isVerified: membership?.isVerified ?? false,
      });
    }
  );
}
