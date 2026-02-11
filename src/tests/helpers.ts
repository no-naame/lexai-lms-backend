import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { hashPassword } from "../lib/passwords.js";
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/tokens.js";

const prisma = new PrismaClient();

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function cleanDatabase() {
  // Truncate all tables in correct order (respecting foreign keys)
  await prisma.$transaction([
    prisma.userLessonProgress.deleteMany(),
    prisma.courseEnrollment.deleteMany(),
    prisma.batchCourseAccess.deleteMany(),
    prisma.organizationCourseAccess.deleteMany(),
    prisma.lesson.deleteMany(),
    prisma.module.deleteMany(),
    prisma.course.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.emailVerificationToken.deleteMany(),
    prisma.studentRecord.deleteMany(),
    prisma.organizationMember.deleteMany(),
    prisma.batch.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.oAuthAccount.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

interface CreateUserOptions {
  email: string;
  password?: string;
  name?: string;
  role?: "PLATFORM_ADMIN" | "INSTITUTION_ADMIN" | "INSTRUCTOR" | "STUDENT";
  emailVerified?: boolean;
  isActive?: boolean;
  isPremium?: boolean;
}

export async function createUser(options: CreateUserOptions) {
  const {
    email,
    password = "password123",
    name = "Test User",
    role = "STUDENT",
    emailVerified = true,
    isActive = true,
    isPremium = false,
  } = options;

  const hashedPw = await hashPassword(password);

  return prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      hashedPassword: hashedPw,
      role,
      emailVerified: emailVerified ? new Date() : null,
      isActive,
      isPremium,
    },
  });
}

/**
 * Creates auth tokens directly via JWT signing, bypassing the HTTP login
 * endpoint and its rate limits. Use this for tests that just need an
 * authenticated session. For tests that specifically test the login
 * endpoint behavior, use loginViaEndpoint() instead.
 */
export async function loginAs(
  app: FastifyInstance,
  email: string,
  _password: string = "password123"
) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) throw new Error(`loginAs: user not found: ${email}`);

  // Build memberships exactly like issueTokens / buildMemberships does
  const members = await prisma.organizationMember.findMany({
    where: { userId: user.id, isActive: true },
    include: { organization: { select: { name: true } } },
  });

  const memberships = members.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: m.role,
    isVerified: m.isVerified,
    batchId: m.batchId,
  }));

  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    memberships,
  };

  // Sign access token using the app's JWT instance
  const accessToken = app.jwt.sign(payload, { expiresIn: "15m" });

  // Create a refresh token in DB (matching what issueTokens does)
  const rawRefreshToken = generateToken();
  const hashedRefresh = hashToken(rawRefreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: hashedRefresh,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const cookies: Record<string, string> = {
    access_token: accessToken,
    refresh_token: rawRefreshToken,
  };

  return { response: null as any, cookies };
}

/**
 * Logs in via the actual HTTP endpoint (POST /auth/login).
 * Use this only in tests that specifically test the login endpoint behavior.
 * This is subject to rate limiting.
 */
export async function loginViaEndpoint(
  app: FastifyInstance,
  email: string,
  password: string = "password123"
) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });

  const cookies = extractCookies(res);
  return { response: res, cookies };
}

export function extractCookies(response: any): Record<string, string> {
  const cookies: Record<string, string> = {};
  const setCookieHeaders = response.headers["set-cookie"];

  if (!setCookieHeaders) return cookies;

  const cookieArray = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];

  for (const cookieStr of cookieArray) {
    const [nameValue] = cookieStr.split(";");
    const eqIndex = nameValue.indexOf("=");
    if (eqIndex !== -1) {
      const name = nameValue.substring(0, eqIndex).trim();
      const value = nameValue.substring(eqIndex + 1).trim();
      cookies[name] = value;
    }
  }

  return cookies;
}

export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function injectWithAuth(
  app: FastifyInstance,
  cookies: Record<string, string>,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: any
) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      cookie: buildCookieHeader(cookies),
    },
  });
}

interface CourseWithContent {
  course: any;
  module: any;
  freeLesson: any;
  paidLesson: any;
}

export async function seedCourseWithModulesAndLessons(): Promise<CourseWithContent> {
  const course = await prisma.course.create({
    data: {
      title: "Test Course",
      slug: "test-course",
      description: "A test course for testing",
      isPublished: true,
      price: 99.99,
    },
  });

  const module = await prisma.module.create({
    data: {
      courseId: course.id,
      title: "Module 1",
      order: 1,
    },
  });

  const freeLesson = await prisma.lesson.create({
    data: {
      moduleId: module.id,
      title: "Free Lesson",
      order: 1,
      type: "VIDEO",
      isFree: true,
      videoUrl: "https://example.com/free-video.mp4",
      content: "Free lesson content",
      duration: 300,
    },
  });

  const paidLesson = await prisma.lesson.create({
    data: {
      moduleId: module.id,
      title: "Paid Lesson",
      order: 2,
      type: "VIDEO",
      isFree: false,
      videoUrl: "https://example.com/paid-video.mp4",
      content: "Paid lesson premium content",
      duration: 600,
    },
  });

  return { course, module, freeLesson, paidLesson };
}

export async function createEnrollment(userId: string, courseId: string, accessSource: "INDIVIDUAL" | "INSTITUTION" = "INDIVIDUAL") {
  return prisma.courseEnrollment.create({
    data: { userId, courseId, accessSource },
  });
}

export async function createOrganization(options: {
  name?: string;
  slug?: string;
  emailDomains?: string[];
  isActive?: boolean;
}) {
  return prisma.organization.create({
    data: {
      name: options.name ?? "Test University",
      slug: options.slug ?? "test-university",
      emailDomains: options.emailDomains ?? ["testuni.edu"],
      isActive: options.isActive ?? true,
    },
  });
}

export async function createOrgMember(options: {
  userId: string;
  organizationId: string;
  role?: "ADMIN" | "STUDENT";
  isVerified?: boolean;
  isActive?: boolean;
  batchId?: string;
  enrollmentId?: string;
}) {
  return prisma.organizationMember.create({
    data: {
      userId: options.userId,
      organizationId: options.organizationId,
      role: options.role ?? "STUDENT",
      isVerified: options.isVerified ?? true,
      isActive: options.isActive ?? true,
      batchId: options.batchId,
      enrollmentId: options.enrollmentId,
    },
  });
}

export async function createBatch(orgId: string, name: string = "Batch 2024") {
  return prisma.batch.create({
    data: {
      organizationId: orgId,
      name,
    },
  });
}

export async function createStudentRecord(options: {
  organizationId: string;
  email: string;
  enrollmentId: string;
  name?: string;
  batchId?: string;
  isClaimed?: boolean;
  claimedByUserId?: string;
}) {
  return prisma.studentRecord.create({
    data: {
      organizationId: options.organizationId,
      email: options.email.toLowerCase(),
      enrollmentId: options.enrollmentId,
      name: options.name ?? "Student",
      batchId: options.batchId,
      isClaimed: options.isClaimed ?? false,
      claimedByUserId: options.claimedByUserId,
    },
  });
}

export async function createPasswordResetToken(userId: string, options?: { used?: boolean; expired?: boolean }) {
  const rawToken = generateToken();
  const hashedTokenValue = hashToken(rawToken);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      token: hashedTokenValue,
      expiresAt: options?.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 60 * 60 * 1000),
      used: options?.used ?? false,
    },
  });

  return rawToken;
}

export async function createEmailVerificationToken(email: string, options?: { expired?: boolean }) {
  const rawToken = generateToken();
  const hashedTokenValue = hashToken(rawToken);

  await prisma.emailVerificationToken.create({
    data: {
      email: email.toLowerCase(),
      token: hashedTokenValue,
      expiresAt: options?.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return rawToken;
}

export async function createPayment(options: {
  userId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount?: number;
  status?: string;
}) {
  return prisma.payment.create({
    data: {
      userId: options.userId,
      razorpayOrderId: options.razorpayOrderId ?? `order_test_${Date.now()}`,
      razorpayPaymentId: options.razorpayPaymentId,
      amount: options.amount ?? 49900,
      status: options.status ?? "created",
      receipt: `receipt_test_${Date.now()}`,
    },
  });
}

export { prisma };
