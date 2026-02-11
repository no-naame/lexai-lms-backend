import type { FastifyInstance } from "fastify";
import { forgotPasswordSchema } from "../../schemas/auth.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { sendPasswordResetEmail } from "../../lib/email.js";

export default async function forgotPasswordRoutes(app: FastifyInstance) {
  app.post(
    "/forgot-password",
    {
      config: {
        rateLimit: { max: 3, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["Auth"],
        summary: "Request password reset",
        description:
          "Send a password reset email if the account exists. Always returns success regardless of whether the email is registered, to prevent email enumeration. Reset token expires in 1 hour.",
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", example: "user@example.com" },
          },
        },
        response: {
          200: {
            description: "Always returns success (prevents email enumeration)",
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: {
                type: "string",
                example: "If an account with that email exists, a password reset link has been sent.",
              },
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
      const parsed = forgotPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      // Always return success to prevent email enumeration
      const successResponse = {
        success: true,
        message: "If an account with that email exists, a password reset link has been sent.",
      };

      const user = await app.prisma.user.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
      });

      // Only send reset email if user exists and has a password (not OAuth-only)
      if (!user || !user.hashedPassword) {
        return reply.send(successResponse);
      }

      // Invalidate any existing reset tokens for this user
      await app.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      });

      // Generate new reset token
      const rawToken = generateToken();
      const hashedTokenValue = hashToken(rawToken);

      await app.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: hashedTokenValue,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      try {
        await sendPasswordResetEmail(user.email, rawToken);
      } catch (err) {
        app.log.error(err, "Failed to send password reset email");
      }

      return reply.send(successResponse);
    }
  );
}
