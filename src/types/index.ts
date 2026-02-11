import type { Role, OrgMemberRole } from "@prisma/client";

export interface JWTPayload {
  userId: string;
  email: string;
  role: Role;
  memberships: MembershipInfo[];
}

export interface MembershipInfo {
  organizationId: string;
  organizationName: string;
  role: OrgMemberRole;
  isVerified: boolean;
  batchId: string | null;
}

export interface GoogleUserInfo {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: JWTPayload;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}
