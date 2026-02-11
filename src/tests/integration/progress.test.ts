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

describe("INTEGRATION — PROGRESS TRACKING", () => {
  let app: FastifyInstance;
  let courseData: Awaited<ReturnType<typeof seedCourseWithModulesAndLessons>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    courseData = await seedCourseWithModulesAndLessons();
  });

  // ─── POST PROGRESS ──────────────────────────────────────────

  describe("POST PROGRESS", () => {
    it("can mark lesson as completed → completedAt set", async () => {
      const user = await createUser({ email: "complete@example.com" });
      const { cookies } = await loginAs(app, "complete@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { completed: true }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().data.progress.completed).toBe(true);
      expect(res.json().data.progress.completedAt).toBeTruthy();
    });

    it("can update watchedSeconds", async () => {
      const user = await createUser({ email: "watch@example.com" });
      const { cookies } = await loginAs(app, "watch@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 120 }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().data.progress.watchedSeconds).toBe(120);
    });

    it("watchedSeconds only increases (no regression)", async () => {
      const user = await createUser({ email: "noreg@example.com" });
      const { cookies } = await loginAs(app, "noreg@example.com");

      // Set to 200
      await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 200 }
      );

      // Try to set to 100 (lower)
      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 100 }
      );

      // Should keep 200
      expect(res.json().data.progress.watchedSeconds).toBe(200);
    });

    it("sending lower watchedSeconds keeps the higher value", async () => {
      const user = await createUser({ email: "higher@example.com" });
      const { cookies } = await loginAs(app, "higher@example.com");

      await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 500 }
      );

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 50 }
      );

      expect(res.json().data.progress.watchedSeconds).toBe(500);
    });

    it("completedAt only set on first completion (not overwritten)", async () => {
      const user = await createUser({ email: "oncecomplete@example.com" });
      const { cookies } = await loginAs(app, "oncecomplete@example.com");

      // First completion
      const res1 = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { completed: true }
      );
      const firstCompletedAt = res1.json().data.progress.completedAt;

      // Second completion (send again)
      const res2 = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { completed: true }
      );
      const secondCompletedAt = res2.json().data.progress.completedAt;

      // completedAt should remain the same
      expect(secondCompletedAt).toBe(firstCompletedAt);
    });

    it("unauthenticated → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        payload: { completed: true },
      });

      expect(res.statusCode).toBe(401);
    });

    it("no subscription for paid lesson → 403", async () => {
      const user = await createUser({ email: "nosub@example.com" });
      const { cookies } = await loginAs(app, "nosub@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.paidLesson.id}/progress`,
        { completed: true }
      );

      expect(res.statusCode).toBe(403);
    });

    it("can track progress on free lesson without subscription", async () => {
      const user = await createUser({ email: "freetrack@example.com" });
      const { cookies } = await loginAs(app, "freetrack@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        { watchedSeconds: 60 }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().data.progress.watchedSeconds).toBe(60);
    });

    it("empty body → valid (both fields optional)", async () => {
      const user = await createUser({ email: "emptybody@example.com" });
      const { cookies } = await loginAs(app, "emptybody@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/test-course/lessons/${courseData.freeLesson.id}/progress`,
        {}
      );

      expect(res.statusCode).toBe(200);
    });
  });

  // ─── GET /courses/:slug/progress ─────────────────────────────

  describe("GET /courses/:slug/progress", () => {
    it("returns correct totalLessons count", async () => {
      const user = await createUser({ email: "total@example.com" });
      const { cookies } = await loginAs(app, "total@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/test-course/progress"
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().data.courseProgress.totalLessons).toBe(2);
    });

    it("returns correct completedLessons count", async () => {
      const user = await createUser({ email: "completed@example.com" });
      const { cookies } = await loginAs(app, "completed@example.com");

      // Complete one lesson
      await prisma.userLessonProgress.create({
        data: {
          userId: user.id,
          lessonId: courseData.freeLesson.id,
          completed: true,
          completedAt: new Date(),
        },
      });

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/test-course/progress"
      );

      expect(res.json().data.courseProgress.completedLessons).toBe(1);
    });

    it("percentComplete is accurate", async () => {
      const user = await createUser({ email: "percent@example.com" });
      const { cookies } = await loginAs(app, "percent@example.com");

      // Complete 1 of 2 lessons = 50%
      await prisma.userLessonProgress.create({
        data: {
          userId: user.id,
          lessonId: courseData.freeLesson.id,
          completed: true,
          completedAt: new Date(),
        },
      });

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/test-course/progress"
      );

      expect(res.json().data.courseProgress.percentComplete).toBe(50);
    });

    it("shows per-lesson breakdown with watchedSeconds", async () => {
      const user = await createUser({ email: "breakdown@example.com" });
      const { cookies } = await loginAs(app, "breakdown@example.com");

      await prisma.userLessonProgress.create({
        data: {
          userId: user.id,
          lessonId: courseData.freeLesson.id,
          watchedSeconds: 150,
        },
      });

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/test-course/progress"
      );

      const modules = res.json().data.modules;
      const lesson = modules[0].lessons.find(
        (l: any) => l.lessonId === courseData.freeLesson.id
      );
      expect(lesson.watchedSeconds).toBe(150);
    });

    it("returns 404 for unpublished course", async () => {
      await prisma.course.create({
        data: { title: "Hidden", slug: "hidden-prog", isPublished: false },
      });

      const user = await createUser({ email: "hiddenp@example.com" });
      const { cookies } = await loginAs(app, "hiddenp@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/hidden-prog/progress"
      );

      expect(res.statusCode).toBe(404);
    });

    it("returns 0% for course with no progress", async () => {
      const user = await createUser({ email: "zerop@example.com" });
      const { cookies } = await loginAs(app, "zerop@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/courses/test-course/progress"
      );

      expect(res.json().data.courseProgress.percentComplete).toBe(0);
      expect(res.json().data.courseProgress.completedLessons).toBe(0);
    });
  });
});
