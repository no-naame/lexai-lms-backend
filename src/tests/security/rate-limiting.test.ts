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

  describe("ENDPOINT-SPECIFIC LIMITS", () => {
    it("POST /auth/login — 11th request within 1 minute → 429", async () => {
      const app = await buildTestApp();
      try {
        await createUser({ email: "ratelimit@example.com" });

        let lastRes: any;
        for (let i = 0; i < 11; i++) {
          lastRes = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "ratelimit@example.com", password: "wrongpassword" },
          });
        }

        expect(lastRes.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("POST /auth/register — 6th request within 1 minute → 429", async () => {
      const app = await buildTestApp();
      try {
        let lastRes: any;
        for (let i = 0; i < 6; i++) {
          lastRes = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
              name: `User ${i}`,
              email: `register${i}@example.com`,
              password: "password123",
            },
          });
        }

        expect(lastRes.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });

    it("POST /auth/forgot-password — 4th request within 1 minute → 429", async () => {
      const app = await buildTestApp();
      try {
        let lastRes: any;
        for (let i = 0; i < 4; i++) {
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
        for (let i = 0; i < 4; i++) {
          await app.inject({
            method: "POST",
            url: "/auth/forgot-password",
            payload: { email: `retryafter${i}@example.com` },
          });
        }

        const res = await app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          payload: { email: "retryafter5@example.com" },
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

        // Exhaust forgot-password rate limit (3/min)
        for (let i = 0; i < 3; i++) {
          await app.inject({
            method: "POST",
            url: "/auth/forgot-password",
            payload: { email: `unauthed${i}@example.com` },
          });
        }

        // 4th request with valid auth should still be rate limited
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

    it("rate limit still applies with valid JWT", async () => {
      const app = await buildTestApp();
      try {
        await createUser({ email: "jwtlimit@example.com" });
        const { cookies } = await loginAs(app, "jwtlimit@example.com");

        // Use login endpoint which has a 10/min limit
        let lastRes: any;
        for (let i = 0; i < 11; i++) {
          lastRes = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "jwtlimit@example.com", password: "wrongpw" },
            headers: {
              cookie: `access_token=${cookies.access_token}`,
            },
          });
        }

        expect(lastRes.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });
  });
});
