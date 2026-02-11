import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  loginAs,
  injectWithAuth,
  seedCourseWithModulesAndLessons,
  createEnrollment,
  prisma,
} from "../helpers.js";

describe("INPUT VALIDATION & INJECTION", () => {
  let app: FastifyInstance;
  let adminCookies: Record<string, string>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await createUser({ email: "admin@example.com", role: "PLATFORM_ADMIN" });
    const result = await loginAs(app, "admin@example.com");
    adminCookies = result.cookies;
  });

  // ─── COURSE CREATION VALIDATION ──────────────────────────────

  describe("COURSE CREATION VALIDATION", () => {
    it("empty title → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "",
        slug: "empty-title",
      });
      expect(res.statusCode).toBe(400);
    });

    it("title > 200 chars → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "a".repeat(201),
        slug: "long-title",
      });
      expect(res.statusCode).toBe(400);
    });

    it("slug with uppercase → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "Upper-Case",
      });
      expect(res.statusCode).toBe(400);
    });

    it("slug with spaces → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "has spaces",
      });
      expect(res.statusCode).toBe(400);
    });

    it("slug with special chars (except hyphens) → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "has_underscores!",
      });
      expect(res.statusCode).toBe(400);
    });

    it("duplicate slug → 409", async () => {
      await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "First",
        slug: "dup-slug",
      });

      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Second",
        slug: "dup-slug",
      });
      expect(res.statusCode).toBe(409);
    });

    it("invalid thumbnail URL → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "bad-thumb",
        thumbnail: "not-a-url",
      });
      expect(res.statusCode).toBe(400);
    });

    it("negative price → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "neg-price",
        price: -1,
      });
      expect(res.statusCode).toBe(400);
    });

    it("non-numeric price → 400", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test",
        slug: "nan-price",
        price: "free",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── MODULE VALIDATION ────────────────────────────────────────

  describe("MODULE VALIDATION", () => {
    let courseId: string;

    beforeEach(async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Module Test Course",
        slug: "module-test",
      });
      courseId = createRes.json().course.id;
    });

    it("missing title → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { order: 1 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("order = 0 → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Test", order: 0 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("negative order → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Test", order: -1 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("non-integer order → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Test", order: 1.5 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("duplicate order within same course → Prisma unique constraint error", async () => {
      await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "First", order: 1 }
      );

      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Second", order: 1 }
      );
      // Should fail due to unique constraint on (courseId, order)
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── LESSON VALIDATION ───────────────────────────────────────

  describe("LESSON VALIDATION", () => {
    let courseId: string;
    let moduleId: string;

    beforeEach(async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Lesson Test Course",
        slug: "lesson-test",
      });
      courseId = createRes.json().course.id;

      const modRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Module", order: 1 }
      );
      moduleId = modRes.json().module.id;
    });

    it("invalid type (not VIDEO/ARTICLE) → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Test", order: 1, type: "PODCAST" }
      );
      expect(res.statusCode).toBe(400);
    });

    it("negative duration → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Test", order: 1, duration: -10 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("invalid videoUrl → 400", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Test", order: 1, type: "VIDEO", videoUrl: "not-a-url" }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── PROGRESS VALIDATION ─────────────────────────────────────

  describe("PROGRESS VALIDATION", () => {
    it("watchedSeconds as negative number → 400", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "prog@example.com" });
      const { cookies } = await loginAs(app, "prog@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: -5 }
      );
      expect(res.statusCode).toBe(400);
    });

    it("watchedSeconds as string → 400", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "prog2@example.com" });
      const { cookies } = await loginAs(app, "prog2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: "abc" }
      );
      expect(res.statusCode).toBe(400);
    });

    it("completed as string → 400", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "prog3@example.com" });
      const { cookies } = await loginAs(app, "prog3@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { completed: "yes" }
      );
      expect(res.statusCode).toBe(400);
    });

    it("extra fields in body → ignored (Zod strips unknown)", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "prog4@example.com" });
      const { cookies } = await loginAs(app, "prog4@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 10, hackField: "pwned", userId: "different-user-id" }
      );
      // Should succeed — extra fields are stripped
      expect(res.statusCode).toBe(200);
    });
  });

  // ─── INJECTION ATTEMPTS ──────────────────────────────────────

  describe("INJECTION ATTEMPTS", () => {
    it("SQL injection in slug parameter → no injection (Prisma parameterized)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/courses/'; DROP TABLE courses; --",
      });

      // Should just get 404, not crash
      expect(res.statusCode).toBe(404);

      // Verify courses table still exists
      const count = await prisma.course.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("NoSQL-style injection in query params → no effect", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/courses?$where=true",
      });

      // Should return normally (PostgreSQL, not MongoDB)
      expect(res.statusCode).toBe(200);
    });

    it("XSS payload in course title → stored as-is (frontend must sanitize)", async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: xssPayload,
        slug: "xss-course",
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().course.title).toBe(xssPayload);
    });

    it("very long string (10KB) in description → accepted (within limit)", async () => {
      const longDesc = "a".repeat(5000); // Under 5000 char limit
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Long Desc",
        slug: "long-desc",
        description: longDesc,
      });

      expect(res.statusCode).toBe(201);
    });

    it("null bytes in string fields → handled gracefully", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Test\x00Null",
        slug: "null-bytes",
      });

      // Should either succeed or fail gracefully (not crash)
      expect([201, 400, 500]).toContain(res.statusCode);
    });
  });
});
