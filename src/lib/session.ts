import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "./tokens.js";
import type { JWTPayload, MembershipInfo } from "../types/index.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const BACKEND_URL = process.env.BACKEND_URL || "";
const IS_TUNNEL = BACKEND_URL.includes("ngrok") || BACKEND_URL.includes("tunnel");
const COOKIE_SECURE = IS_PRODUCTION || IS_TUNNEL;
const COOKIE_SAME_SITE: "lax" | "none" = IS_TUNNEL ? "none" : "lax";

export async function buildMemberships(
  prisma: PrismaClient,
  userId: string
): Promise<MembershipInfo[]> {
  const members = await prisma.organizationMember.findMany({
    where: { userId, isActive: true },
    include: { organization: { select: { name: true } } },
  });

  return members.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: m.role,
    isVerified: m.isVerified,
    batchId: m.batchId,
  }));
}

export async function issueTokens(
  app: FastifyInstance,
  reply: FastifyReply,
  user: { id: string; email: string; role: string },
  prisma: PrismaClient
) {
  const memberships = await buildMemberships(prisma, user.id);

  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role as JWTPayload["role"],
    memberships,
  };

  // Sign access token
  const accessToken = app.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY });

  // Generate and store refresh token
  const rawRefreshToken = generateToken();
  const hashedRefresh = hashToken(rawRefreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: hashedRefresh,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  // Set cookies
  reply.setCookie("access_token", accessToken, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    path: "/",
    maxAge: 15 * 60, // 15 minutes in seconds
  });

  reply.setCookie("refresh_token", rawRefreshToken, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    path: "/auth/refresh",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  return { accessToken, memberships };
}

export async function revokeRefreshToken(
  prisma: PrismaClient,
  rawToken: string
) {
  const hashed = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { token: hashed },
    data: { isRevoked: true },
  });
}

export async function revokeAllUserTokens(
  prisma: PrismaClient,
  userId: string
) {
  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie("access_token", { path: "/" });
  reply.clearCookie("refresh_token", { path: "/auth/refresh" });
}
