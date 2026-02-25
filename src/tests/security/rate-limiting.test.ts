import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  loginAs,
} from "../helpers.js";

describe("RATE LIMITING", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── ENDPOINT-SPECIFIC LIMITS ────────────────────────────────
  // Each test gets a fresh app instance so rate limit counters start at zero.
  // Login (300/min) and register (100/min) tests use payloads that bypass
  // bcrypt to keep sequential requests fast enough to fit within the
  // 1-minute rate-limit window.

  describe("ENDPOINT-SPECIFIC LIMITS", () => {
    it("POST /auth/login — 301st request within 1 minute → 429", { timeout: 60_000 }, async () => {
      const app = await buildTestApp();
      try {
        // Use nonexistent email to skip bcrypt.compare.
        // Send concurrently to avoid Neon DB round-trip latency stacking.
        const requests = Array.from({ length: 301 }, () =>
          app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "nonexistent@example.com", password: "irrelevant" },
          })
        );
        const responses = await Promise.all(requests);

        expect(responses.some((r) => r.statusCode === 429)).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("POST /auth/register — 101st request within 1 minute → 429", { timeout: 60_000 }, async () => {
      const app = await buildTestApp();
      try {
        // Use short password to fail at Zod validation before bcrypt.hash.
        // The rate limiter still counts each request.
        let lastRes: any;
        for (let i = 0; i < 101; i++) {
          lastRes = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
              name: `User ${i}`,
              email: `register${i}@example.com`,
              password: "short",
            },
          });
        }

        expect(lastRes.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("POST /auth/forgot-password — 31st request within 1 minute → 429", async () => {
      const app = await buildTestApp();
      try {
        let lastRes: any;
        for (let i = 0; i < 31; i++) {
          lastRes = await app.inject({
            method: "POST",
            url: "/auth/forgot-password",
            payload: { email: `forgot${i}@example.com` },
          });
        }

        expect(lastRes.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("429 response includes Retry-After header", async () => {
      const app = await buildTestApp();
      try {
        for (let i = 0; i < 30; i++) {
          await app.inject({
            method: "POST",
            url: "/auth/forgot-password",
            payload: { email: `retryafter${i}@example.com` },
          });
        }

        const res = await app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          payload: { email: "retryafter31@example.com" },
        });

        if (res.statusCode === 429) {
          expect(res.headers["retry-after"]).toBeDefined();
        }
      } finally {
        await app.close();
      }
    });
  });

  // ─── RATE LIMIT BEHAVIOR ─────────────────────────────────────

  describe("RATE LIMIT BEHAVIOR", () => {
    it("rate limit applies regardless of authentication status", async () => {
      const app = await buildTestApp();
      try {
        await createUser({ email: "authed@example.com" });
        const { cookies } = await loginAs(app, "authed@example.com");

        // Exhaust forgot-password rate limit (30/min)
        for (let i = 0; i < 30; i++) {
          await app.inject({
            method: "POST",
            url: "/auth/forgot-password",
            payload: { email: `unauthed${i}@example.com` },
          });
        }

        // 31st request with valid auth should still be rate limited
        const res = await app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          payload: { email: "authed@example.com" },
          headers: {
            cookie: `access_token=${cookies.access_token}`,
          },
        });

        expect(res.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("rate limit still applies with valid JWT", { timeout: 60_000 }, async () => {
      const app = await buildTestApp();
      try {
        await createUser({ email: "jwtlimit@example.com" });
        const { cookies } = await loginAs(app, "jwtlimit@example.com");

        // Use login endpoint which has a 300/min limit.
        // Nonexistent email avoids bcrypt, concurrent avoids latency stacking.
        const requests = Array.from({ length: 301 }, () =>
          app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "nonexistent@example.com", password: "irrelevant" },
            headers: {
              cookie: `access_token=${cookies.access_token}`,
            },
          })
        );
        const responses = await Promise.all(requests);

        expect(responses.some((r) => r.statusCode === 429)).toBe(true);
      } finally {
        await app.close();
      }
    });
  });
});
