import type { FastifyInstance } from "fastify";
import { loginSchema } from "../../schemas/auth.js";
import { verifyPassword } from "../../lib/passwords.js";
import { issueTokens } from "../../lib/session.js";
import { findOrganizationByEmail } from "../../lib/domain-check.js";

export default async function loginRoutes(app: FastifyInstance) {
  app.post(
    "/login",
    {
      config: {
        rateLimit: { max: 300, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["Auth"],
        summary: "Login",
        description:
          "Authenticate with email and password. Sets httpOnly cookies with access_token (15min) and refresh_token (7 days). Returns the same error for wrong password and nonexistent email to prevent user enumeration.",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "student@example.com" },
            password: { type: "string", example: "password123" },
          },
        },
        response: {
          200: {
            description: "Login successful. Auth cookies set via Set-Cookie headers.",
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              requiresInstitutionVerification: { type: "boolean", example: false },
              organizationSlug: { type: "string", nullable: true },
            },
          },
          401: {
            description: "Invalid credentials (wrong password, nonexistent user, or OAuth-only account)",
            type: "object",
            properties: { error: { type: "string", example: "Invalid email or password" } },
          },
          403: {
            description: "Email not verified or account deactivated",
            type: "object",
            properties: {
              error: { type: "string", example: "Please verify your email before signing in" },
              code: { type: "string", example: "EMAIL_NOT_VERIFIED" },
            },
          },
          400: {
            description: "Validation error",
            type: "object",
            properties: { error: { type: "string" }, details: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { email, password } = parsed.data;

      const user = await app.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user || !user.hashedPassword) {
        return reply.status(401).send({
          error: "Invalid email or password",
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          error: "Account is deactivated",
        });
      }

      const valid = await verifyPassword(password, user.hashedPassword);
      if (!valid) {
        return reply.status(401).send({
          error: "Invalid email or password",
        });
      }

      if (!user.emailVerified) {
        return reply.status(403).send({
          error: "Please verify your email before signing in",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

      // Issue tokens
      const { memberships } = await issueTokens(app, reply, user, app.prisma);

      // Check if institutional verification needed
      const org = await findOrganizationByEmail(app.prisma, user.email);
      let requiresInstitutionVerification = false;

      if (org) {
        const membership = memberships.find(
          (m) => m.organizationId === org.id
        );
        if (!membership) {
          // Has institutional domain but no membership yet
          requiresInstitutionVerification = true;
        }
      }

      return reply.send({
        success: true,
        requiresInstitutionVerification,
        organizationSlug: requiresInstitutionVerification ? org?.slug : undefined,
      });
    }
  );
}
