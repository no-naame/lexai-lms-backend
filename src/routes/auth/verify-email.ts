import type { FastifyInstance } from "fastify";
import { hashToken } from "../../lib/tokens.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

export default async function verifyEmailRoutes(app: FastifyInstance) {
  // GET /auth/verify-email?token=xxx
  app.get(
    "/verify-email",
    {
      schema: {
        tags: ["Auth"],
        summary: "Verify email address",
        description:
          "Verify a user's email via the link sent during registration. Redirects to the frontend sign-in page with a query parameter indicating success or failure. Token expires in 24 hours.",
        querystring: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string", description: "Verification token from the email link" },
          },
        },
        response: {
          302: {
            description:
              "Redirects to frontend: ?verified=true on success, ?error=token_expired or ?error=invalid_token on failure",
          },
        },
      },
    },
    async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.redirect(`${FRONTEND_URL}/sign-in?error=invalid_token`);
    }

    const hashedTokenValue = hashToken(token);

    const tokenRecord = await app.prisma.emailVerificationToken.findUnique({
      where: { token: hashedTokenValue },
    });

    if (!tokenRecord) {
      return reply.redirect(`${FRONTEND_URL}/sign-in?error=invalid_token`);
    }

    if (tokenRecord.expiresAt < new Date()) {
      await app.prisma.emailVerificationToken.delete({
        where: { id: tokenRecord.id },
      });
      return reply.redirect(`${FRONTEND_URL}/sign-in?error=token_expired`);
    }

    // Verify the email
    await app.prisma.user.updateMany({
      where: { email: tokenRecord.email },
      data: { emailVerified: new Date() },
    });

    // Delete the token
    await app.prisma.emailVerificationToken.delete({
      where: { id: tokenRecord.id },
    });

    return reply.redirect(`${FRONTEND_URL}/sign-in?verified=true`);
  });
}
