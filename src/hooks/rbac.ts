import type { FastifyRequest, FastifyReply } from "fastify";
import type { Role } from "@prisma/client";

/**
 * Role-based access control hook factory.
 * Returns a preHandler that checks if the user has one of the required roles.
 */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!roles.includes(request.currentUser.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
  };
}

/**
 * Check if the user is a member (with specified role) of the given organization.
 * Used for institution-scoped routes.
 */
export function requireOrgRole(
  ...roles: Array<"ADMIN" | "STUDENT">
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    // Platform admins can access any org
    if (request.currentUser.role === "PLATFORM_ADMIN") {
      return;
    }

    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      return reply.status(400).send({ error: "Organization ID required" });
    }

    const membership = request.currentUser.memberships.find(
      (m) => m.organizationId === orgId
    );

    if (!membership || !membership.isVerified) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    if (roles.length > 0 && !roles.includes(membership.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
  };
}
