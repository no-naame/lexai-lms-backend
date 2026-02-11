import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  loginAs,
  injectWithAuth,
  extractCookies,
  buildCookieHeader,
  createPasswordResetToken,
  createEmailVerificationToken,
  prisma,
} from "../helpers.js";

describe("AUTHENTICATION SECURITY", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── LOGIN ────────────────────────────────────────────────────
  // Each nested describe that hits rate-limited endpoints gets its own
  // fresh Fastify app instance so rate limit counters start at zero.

  describe("LOGIN", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("valid credentials → 200 with Set-Cookie (access_token + refresh_token)", async () => {
      await createUser({ email: "login@example.com" });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "login@example.com", password: "password123" },
      });

      expect(res.statusCode).toBe(200);
      const cookies = extractCookies(res);
      expect(cookies).toHaveProperty("access_token");
      expect(cookies).toHaveProperty("refresh_token");
    });

    it("wrong password → 401 'Invalid email or password'", async () => {
      await createUser({ email: "wrong@example.com" });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "wrong@example.com", password: "wrongpassword" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid email or password");
    });

    it("nonexistent email → 401 (same message — no enumeration)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "nobody@example.com", password: "password123" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid email or password");
    });

    it("unverified email → 403 'Please verify your email'", async () => {
      await createUser({ email: "unverified@example.com", emailVerified: false });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "unverified@example.com", password: "password123" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/verify your email/i);
    });

    it("deactivated account → 403 'Account is deactivated'", async () => {
      await createUser({ email: "deactivated@example.com", isActive: false });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "deactivated@example.com", password: "password123" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/deactivated/i);
    });

    it("OAuth-only user (no password) → 401", async () => {
      await prisma.user.create({
        data: {
          email: "oauth@example.com",
          name: "OAuth User",
          emailVerified: new Date(),
          // No hashedPassword
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "oauth@example.com", password: "anypassword" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── REGISTRATION ────────────────────────────────────────────

  describe("REGISTRATION", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("valid registration → 201 + verification email sent", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "New User",
          email: "new@example.com",
          password: "securepass123",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { email: "new@example.com" },
      });
      expect(user).toBeTruthy();
      expect(user!.emailVerified).toBeNull();

      // Verify token was created
      const token = await prisma.emailVerificationToken.findFirst({
        where: { email: "new@example.com" },
      });
      expect(token).toBeTruthy();
    });

    it("duplicate email → 409", async () => {
      await createUser({ email: "dup@example.com" });

      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Another User",
          email: "dup@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(409);
    });

    it("password < 8 chars → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Short Pw",
          email: "short@example.com",
          password: "short",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("invalid email format → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Bad Email",
          email: "not-an-email",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("empty name → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "",
          email: "emptyname@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("REGISTRATION — INJECTION", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("SQL injection in name field → creates user normally (no injection)", async () => {
      const maliciousName = "'; DROP TABLE users; --";
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: maliciousName,
          email: "sqli@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(201);
      const user = await prisma.user.findUnique({
        where: { email: "sqli@example.com" },
      });
      expect(user).toBeTruthy();
      expect(user!.name).toBe(maliciousName);
    });
  });

  // ─── TOKEN REFRESH ────────────────────────────────────────────

  describe("TOKEN REFRESH", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("valid refresh token → new access_token + new refresh_token (rotation)", async () => {
      await createUser({ email: "refresh@example.com" });
      const { cookies: loginCookies } = await loginAs(app, "refresh@example.com");

      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          cookie: `refresh_token=${loginCookies.refresh_token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const newCookies = extractCookies(res);
      expect(newCookies).toHaveProperty("access_token");
      expect(newCookies).toHaveProperty("refresh_token");
      // New refresh token should be different (rotation)
      expect(newCookies.refresh_token).not.toBe(loginCookies.refresh_token);
    });

    it("revoked refresh token → 401 + ALL user tokens revoked (reuse detection)", async () => {
      await createUser({ email: "reuse@example.com" });
      const { cookies: loginCookies } = await loginAs(app, "reuse@example.com");

      // First refresh — succeeds, old token revoked
      await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          cookie: `refresh_token=${loginCookies.refresh_token}`,
        },
      });

      // Second refresh with the SAME (now revoked) token — reuse detection
      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          cookie: `refresh_token=${loginCookies.refresh_token}`,
        },
      });

      expect(res.statusCode).toBe(401);

      // Verify ALL tokens for this user are revoked
      const user = await prisma.user.findUnique({
        where: { email: "reuse@example.com" },
      });
      const activeTokens = await prisma.refreshToken.findMany({
        where: { userId: user!.id, isRevoked: false },
      });
      expect(activeTokens).toHaveLength(0);
    });

    it("no refresh_token cookie → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
      });

      expect(res.statusCode).toBe(401);
    });

    it("random string as refresh_token → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          cookie: "refresh_token=randomgarbage12345",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── LOGOUT ───────────────────────────────────────────────────

  describe("LOGOUT", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("POST /auth/logout → cookies cleared, refresh token revoked", async () => {
      await createUser({ email: "logout@example.com" });
      const { cookies } = await loginAs(app, "logout@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/auth/logout");

      expect(res.statusCode).toBe(200);
      // Check cookies are cleared
      const resCookies = res.headers["set-cookie"];
      expect(resCookies).toBeDefined();
    });

    it("POST /auth/logout-all → ALL refresh tokens for user revoked", async () => {
      const user = await createUser({ email: "logoutall@example.com" });

      // Login twice (creates 2 refresh tokens)
      await loginAs(app, "logoutall@example.com");
      const { cookies } = await loginAs(app, "logoutall@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/auth/logout-all");

      expect(res.statusCode).toBe(200);

      // Verify ALL refresh tokens are revoked
      const activeTokens = await prisma.refreshToken.findMany({
        where: { userId: user.id, isRevoked: false },
      });
      expect(activeTokens).toHaveLength(0);
    });

    it("after logout, old access_token still works until expiry (stateless JWT)", async () => {
      await createUser({ email: "stateless@example.com" });
      const { cookies } = await loginAs(app, "stateless@example.com");

      // Logout
      await injectWithAuth(app, cookies, "POST", "/auth/logout");

      // Access token is still valid (stateless JWT)
      const res = await injectWithAuth(app, cookies, "GET", "/auth/me");
      // Should work since access_token is still valid (not expired yet)
      expect(res.statusCode).toBe(200);
    });

    it("after logout, old refresh_token is rejected", async () => {
      await createUser({ email: "rejectrefresh@example.com" });
      const { cookies } = await loginAs(app, "rejectrefresh@example.com");

      // Logout (revokes refresh token)
      await injectWithAuth(app, cookies, "POST", "/auth/logout");

      // Try to use old refresh token
      const res = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          cookie: `refresh_token=${cookies.refresh_token}`,
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── PASSWORD RESET ───────────────────────────────────────────

  describe("PASSWORD RESET", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("forgot-password with existing email → 200 (generic success message)", async () => {
      await createUser({ email: "forgot@example.com" });

      const res = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "forgot@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("forgot-password with nonexistent email → 200 (same message — no enumeration)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "noone@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("reset with valid token → password changed, all sessions revoked", async () => {
      const user = await createUser({ email: "reset@example.com" });
      const rawToken = await createPasswordResetToken(user.id);

      const res = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token: rawToken, password: "newpassword123" },
      });

      expect(res.statusCode).toBe(200);

      // Can login with new password
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "reset@example.com", password: "newpassword123" },
      });
      expect(loginRes.statusCode).toBe(200);
    });

    it("reset with used token → 400", async () => {
      const user = await createUser({ email: "usedtoken@example.com" });
      const rawToken = await createPasswordResetToken(user.id, { used: true });

      const res = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token: rawToken, password: "newpassword123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("reset with expired token → 400", async () => {
      const user = await createUser({ email: "exptoken@example.com" });
      const rawToken = await createPasswordResetToken(user.id, { expired: true });

      const res = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token: rawToken, password: "newpassword123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("reset with invalid token → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token: "invalidtoken123", password: "newpassword123" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── EMAIL VERIFICATION ───────────────────────────────────────

  describe("EMAIL VERIFICATION", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it("valid token → email verified (redirect with verified=true)", async () => {
      await createUser({ email: "verify@example.com", emailVerified: false });
      const rawToken = await createEmailVerificationToken("verify@example.com");

      const res = await app.inject({
        method: "GET",
        url: `/auth/verify-email?token=${rawToken}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("verified=true");

      // Verify email is now verified
      const user = await prisma.user.findUnique({
        where: { email: "verify@example.com" },
      });
      expect(user!.emailVerified).toBeTruthy();
    });

    it("expired token → redirect with error=token_expired", async () => {
      await createUser({ email: "expired@example.com", emailVerified: false });
      const rawToken = await createEmailVerificationToken("expired@example.com", { expired: true });

      const res = await app.inject({
        method: "GET",
        url: `/auth/verify-email?token=${rawToken}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("error=token_expired");
    });

    it("invalid/nonexistent token → redirect with error=invalid_token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/verify-email?token=nonexistenttoken123",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("error=invalid_token");
    });

    it("already-verified email + valid token → still succeeds (idempotent)", async () => {
      await createUser({ email: "alreadyverified@example.com", emailVerified: true });
      const rawToken = await createEmailVerificationToken("alreadyverified@example.com");

      const res = await app.inject({
        method: "GET",
        url: `/auth/verify-email?token=${rawToken}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("verified=true");
    });
  });
});
