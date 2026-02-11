import type { FastifyRequest, FastifyReply } from "fastify";
import type { JWTPayload } from "../types/index.js";

/**
 * Authentication hook - verifies JWT from httpOnly cookie.
 * Decorates request with currentUser containing the JWT payload.
 * Returns 401 if token is missing or invalid.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const payload = await request.jwtVerify<JWTPayload>();
    request.currentUser = payload;
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

/**
 * Optional authentication hook - tries to verify JWT but does not fail.
 * If token is valid, decorates request with currentUser.
 * If token is missing or invalid, continues without setting currentUser.
 */
export async function optionalAuthenticate(
  request: FastifyRequest,
  _reply: FastifyReply
) {
  try {
    const payload = await request.jwtVerify<JWTPayload>();
    request.currentUser = payload;
  } catch {
    // Not authenticated — that's fine
  }
}
