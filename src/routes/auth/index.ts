import type { FastifyInstance } from "fastify";
import googleRoutes from "./google.js";
import registerRoutes from "./register.js";
import loginRoutes from "./login.js";
import verifyEmailRoutes from "./verify-email.js";
import forgotPasswordRoutes from "./forgot-password.js";
import resetPasswordRoutes from "./reset-password.js";
import refreshRoutes from "./refresh.js";
import logoutRoutes from "./logout.js";
import verifyInstitutionRoutes from "./verify-institution.js";
import { authenticate } from "../../hooks/auth.js";

export default async function authRoutes(app: FastifyInstance) {
  await app.register(googleRoutes);
  await app.register(registerRoutes);
  await app.register(loginRoutes);
  await app.register(verifyEmailRoutes);
  await app.register(forgotPasswordRoutes);
  await app.register(resetPasswordRoutes);
  await app.register(refreshRoutes);
  await app.register(logoutRoutes);
  await app.register(verifyInstitutionRoutes);

  // GET /auth/me - Get current user info
  app.get(
    "/me",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Get current user",
        description:
          "Get the authenticated user's profile and organization memberships. Requires a valid access_token cookie.",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "User profile with memberships",
            type: "object",
            properties: {
              user: {
                type: "object",
                properties: {
                  id: { type: "string", example: "clx1234567890" },
                  name: { type: "string", example: "Jane Smith" },
                  email: { type: "string", example: "jane@example.com" },
                  image: { type: "string", nullable: true },
                  role: {
                    type: "string",
                    enum: ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "INSTRUCTOR", "STUDENT"],
                    example: "STUDENT",
                  },
                  emailVerified: { type: "string", format: "date-time", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
              memberships: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    organizationId: { type: "string" },
                    organizationName: { type: "string", example: "Acme University" },
                    role: { type: "string", enum: ["ADMIN", "STUDENT"] },
                    isVerified: { type: "boolean" },
                    batchId: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          401: {
            description: "Not authenticated",
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            description: "User not found (deleted while token still valid)",
            type: "object",
            properties: { error: { type: "string", example: "User not found" } },
          },
        },
      },
    },
    async (request, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: request.currentUser!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply.send({
      user,
      memberships: request.currentUser!.memberships,
    });
  });
}
