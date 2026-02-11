import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import {
  revokeRefreshToken,
  revokeAllUserTokens,
  clearAuthCookies,
} from "../../lib/session.js";

export default async function logoutRoutes(app: FastifyInstance) {
  // POST /auth/logout - Logout current session
  app.post(
    "/logout",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Logout",
        description:
          "Revoke the current refresh token and clear auth cookies. The access_token JWT remains valid until its 15-minute expiry (stateless JWT cannot be revoked server-side).",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "Logged out successfully",
            type: "object",
            properties: { success: { type: "boolean", example: true } },
          },
        },
      },
    },
    async (request, reply) => {
      const rawToken = request.cookies.refresh_token;

      if (rawToken) {
        await revokeRefreshToken(app.prisma, rawToken);
      }

      clearAuthCookies(reply);

      return reply.send({ success: true });
    }
  );

  // POST /auth/logout-all - Logout from all devices
  app.post(
    "/logout-all",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Logout from all devices",
        description:
          "Revoke ALL refresh tokens for the current user, forcing re-authentication on every device. Clears current session cookies.",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "All sessions revoked",
            type: "object",
            properties: { success: { type: "boolean", example: true } },
          },
        },
      },
    },
    async (request, reply) => {
      await revokeAllUserTokens(app.prisma, request.currentUser!.userId);
      clearAuthCookies(reply);

      return reply.send({ success: true });
    }
  );
}
