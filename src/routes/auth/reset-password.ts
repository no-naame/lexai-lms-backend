import type { FastifyInstance } from "fastify";
import { resetPasswordSchema } from "../../schemas/auth.js";
import { hashPassword } from "../../lib/passwords.js";
import { hashToken } from "../../lib/tokens.js";
import { revokeAllUserTokens } from "../../lib/session.js";

export default async function resetPasswordRoutes(app: FastifyInstance) {
  app.post(
    "/reset-password",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["Auth"],
        summary: "Reset password",
        description:
          "Reset password using the token from the reset email. On success, all refresh tokens for the user are revoked, forcing re-login on all devices. Token is single-use and expires in 1 hour.",
        body: {
          type: "object",
          required: ["token", "password"],
          properties: {
            token: {
              type: "string",
              description: "Raw token from the password reset email link",
              example: "abc123def456",
            },
            password: {
              type: "string",
              minLength: 8,
              maxLength: 128,
              description: "New password (8-128 characters)",
              example: "newsecurepass123",
            },
          },
        },
        response: {
          200: {
            description: "Password changed. All sessions revoked.",
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: {
                type: "string",
                example: "Password has been reset. Please sign in with your new password.",
              },
            },
          },
          400: {
            description: "Invalid, expired, or already-used token",
            type: "object",
            properties: { error: { type: "string", example: "Invalid or expired reset token" } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { token, password } = parsed.data;
      const hashedTokenValue = hashToken(token);

      const tokenRecord = await app.prisma.passwordResetToken.findUnique({
        where: { token: hashedTokenValue },
      });

      if (!tokenRecord || tokenRecord.used || tokenRecord.expiresAt < new Date()) {
        return reply.status(400).send({
          error: "Invalid or expired reset token",
        });
      }

      // Hash new password and update user
      const hashedPassword = await hashPassword(password);

      await app.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { hashedPassword },
      });

      // Mark token as used
      await app.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { used: true },
      });

      // Revoke all refresh tokens (force re-login everywhere)
      await revokeAllUserTokens(app.prisma, tokenRecord.userId);

      return reply.send({
        success: true,
        message: "Password has been reset. Please sign in with your new password.",
      });
    }
  );
}
