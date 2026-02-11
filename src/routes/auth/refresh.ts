import type { FastifyInstance } from "fastify";
import { hashToken } from "../../lib/tokens.js";
import { issueTokens, revokeRefreshToken, clearAuthCookies } from "../../lib/session.js";

export default async function refreshRoutes(app: FastifyInstance) {
  app.post(
    "/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Refresh tokens",
        description:
          "Exchange a valid refresh_token cookie for new access_token + refresh_token (token rotation). The old refresh token is revoked. If a revoked token is reused, ALL user tokens are revoked as a security measure (token theft detection).",
        response: {
          200: {
            description: "New tokens issued via Set-Cookie headers. Old refresh token revoked.",
            type: "object",
            properties: { success: { type: "boolean", example: true } },
          },
          401: {
            description: "No cookie, invalid/expired/revoked token",
            type: "object",
            properties: { error: { type: "string", example: "Invalid refresh token" } },
          },
          403: {
            description: "Account deactivated",
            type: "object",
            properties: { error: { type: "string", example: "Account deactivated" } },
          },
        },
      },
    },
    async (request, reply) => {
    const rawToken = request.cookies.refresh_token;

    if (!rawToken) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: "No refresh token" });
    }

    const hashedTokenValue = hashToken(rawToken);

    const tokenRecord = await app.prisma.refreshToken.findUnique({
      where: { token: hashedTokenValue },
      include: { user: true },
    });

    if (
      !tokenRecord ||
      tokenRecord.isRevoked ||
      tokenRecord.expiresAt < new Date()
    ) {
      // If token was already used (revoked), this could be a stolen token
      // Revoke all tokens for this user as a security measure
      if (tokenRecord && tokenRecord.isRevoked) {
        await app.prisma.refreshToken.updateMany({
          where: { userId: tokenRecord.userId },
          data: { isRevoked: true },
        });
      }

      clearAuthCookies(reply);
      return reply.status(401).send({ error: "Invalid refresh token" });
    }

    if (!tokenRecord.user.isActive) {
      clearAuthCookies(reply);
      return reply.status(403).send({ error: "Account deactivated" });
    }

    // Revoke old refresh token (rotation)
    await revokeRefreshToken(app.prisma, rawToken);

    // Issue new tokens
    await issueTokens(app, reply, tokenRecord.user, app.prisma);

    return reply.send({ success: true });
  });
}
