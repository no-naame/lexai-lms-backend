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

describe("INTEGRATION — USER ROUTES", () => {
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

  // ─── GET /user/enrollments ──────────────────────────────────

  describe("GET /user/enrollments", () => {
    it("returns empty list when user has no enrollments", async () => {
      const user = await createUser({ email: "noenroll@example.com" });
      const { cookies } = await loginAs(app, "noenroll@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/user/enrollments");
      expect(res.statusCode).toBe(200);
      expect(res.json().data.enrollments).toHaveLength(0);
    });

    it("returns enrollments with progress info", async () => {
      const user = await createUser({ email: "enrolled@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "enrolled@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/user/enrollments");
      expect(res.statusCode).toBe(200);

      const enrollments = res.json().data.enrollments;
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].courseId).toBe("test-course");
      expect(enrollments[0].title).toBe("Test Course");
      expect(enrollments[0]).toHaveProperty("status");
      expect(enrollments[0]).toHaveProperty("progressPercentage");
      expect(enrollments[0]).toHaveProperty("completedLessons");
      expect(enrollments[0]).toHaveProperty("totalLessons");
      expect(enrollments[0]).toHaveProperty("enrolledAt");
    });

    it("requires authentication", async () => {
      const res = await app.inject({ method: "GET", url: "/user/enrollments" });
      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /user/enrollments/:courseId ────────────────────────

  describe("GET /user/enrollments/:courseId", () => {
    it("returns detailed progress for enrolled course", async () => {
      const user = await createUser({ email: "detail@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "detail@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/user/enrollments/test-course"
      );
      expect(res.statusCode).toBe(200);

      const body = res.json().data;
      expect(body.courseId).toBe("test-course");
      expect(body.title).toBe("Test Course");
      expect(body.modules).toBeDefined();
      expect(body.modules).toHaveLength(1);
      expect(body.modules[0].lessons).toHaveLength(2);
      expect(body.modules[0].lessons[0]).toHaveProperty("isCompleted");
      expect(body.modules[0].lessons[0]).toHaveProperty("watchedSeconds");
    });

    it("returns 404 if not enrolled", async () => {
      const user = await createUser({ email: "notenrolled@example.com" });
      const { cookies } = await loginAs(app, "notenrolled@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/user/enrollments/test-course"
      );
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for nonexistent course", async () => {
      const user = await createUser({ email: "nocourse@example.com" });
      const { cookies } = await loginAs(app, "nocourse@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        "/user/enrollments/nonexistent"
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /user/enrollments/:courseId ───────────────────────

  describe("POST /user/enrollments/:courseId", () => {
    it("enrolls user in a course", async () => {
      const user = await createUser({ email: "newenroll@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "newenroll@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        "/user/enrollments/test-course"
      );
      expect(res.statusCode).toBe(201);

      const body = res.json().data;
      expect(body.enrollment.courseId).toBe("test-course");
      expect(body.enrollment.status).toBe("not-started");
      expect(body.enrollment.progressPercentage).toBe(0);
    });

    it("increments studentsCount on enrollment", async () => {
      const user = await createUser({ email: "counttest@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "counttest@example.com");

      const before = await prisma.course.findUnique({
        where: { slug: "test-course" },
        select: { studentsCount: true },
      });

      await injectWithAuth(
        app,
        cookies,
        "POST",
        "/user/enrollments/test-course"
      );

      const after = await prisma.course.findUnique({
        where: { slug: "test-course" },
        select: { studentsCount: true },
      });

      expect(after!.studentsCount).toBe(before!.studentsCount + 1);
    });

    it("returns 409 if already enrolled", async () => {
      const user = await createUser({ email: "alreadyin@example.com", isPremium: true });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "alreadyin@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        "/user/enrollments/test-course"
      );
      expect(res.statusCode).toBe(409);
    });

    it("returns 404 for nonexistent course", async () => {
      const user = await createUser({ email: "noslug@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "noslug@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        "/user/enrollments/nonexistent"
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PUT /user/lessons/:lessonId/progress ───────────────────

  describe("PUT /user/lessons/:lessonId/progress", () => {
    it("updates watch progress", async () => {
      const user = await createUser({ email: "watchprog@example.com" });
      const { cookies } = await loginAs(app, "watchprog@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "PUT",
        `/user/lessons/${courseData.freeLesson.id}/progress`,
        { courseId: "test-course", watchedSeconds: 120 }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().data.progress.watchedSeconds).toBe(120);
    });

    it("updates enrollment lastAccessedAt and currentLessonId", async () => {
      const user = await createUser({ email: "access@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "access@example.com");

      await injectWithAuth(
        app,
        cookies,
        "PUT",
        `/user/lessons/${courseData.freeLesson.id}/progress`,
        { courseId: "test-course", watchedSeconds: 60 }
      );

      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId: user.id, courseId: courseData.course.id },
        },
      });

      expect(enrollment!.lastAccessedAt).toBeTruthy();
      expect(enrollment!.currentLessonId).toBe(courseData.freeLesson.id);
      expect(enrollment!.status).toBe("in-progress");
    });

    it("returns 404 for nonexistent lesson", async () => {
      const user = await createUser({ email: "nolesson@example.com" });
      const { cookies } = await loginAs(app, "nolesson@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "PUT",
        "/user/lessons/nonexistent-id/progress",
        { courseId: "test-course", watchedSeconds: 60 }
      );

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /user/lessons/:lessonId/complete ──────────────────

  describe("POST /user/lessons/:lessonId/complete", () => {
    it("marks lesson as complete", async () => {
      const user = await createUser({ email: "complete@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "complete@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.freeLesson.id}/complete`,
        { courseId: "test-course" }
      );

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.progress.isCompleted).toBe(true);
      expect(body.progress.completedAt).toBeTruthy();
    });

    it("recomputes course progress percentage", async () => {
      const user = await createUser({ email: "recompute@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "recompute@example.com");

      // Complete 1 of 2 lessons = 50%
      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.freeLesson.id}/complete`,
        { courseId: "test-course" }
      );

      const body = res.json().data;
      expect(body.courseProgress.completedLessons).toBe(1);
      expect(body.courseProgress.totalLessons).toBe(2);
      expect(body.courseProgress.progressPercentage).toBe(50);
    });

    it("updates enrollment progress and status", async () => {
      const user = await createUser({ email: "enrollstatus@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "enrollstatus@example.com");

      await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.freeLesson.id}/complete`,
        { courseId: "test-course" }
      );

      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId: user.id, courseId: courseData.course.id },
        },
      });

      expect(enrollment!.progressPercentage).toBe(50);
      expect(enrollment!.status).toBe("in-progress");
    });

    it("sets status to completed when all lessons done", async () => {
      const user = await createUser({ email: "alldone@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "alldone@example.com");

      // Complete both lessons
      await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.freeLesson.id}/complete`,
        { courseId: "test-course" }
      );
      await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.paidLesson.id}/complete`,
        { courseId: "test-course" }
      );

      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId: user.id, courseId: courseData.course.id },
        },
      });

      expect(enrollment!.progressPercentage).toBe(100);
      expect(enrollment!.status).toBe("completed");
    });

    it("returns 404 for nonexistent course slug", async () => {
      const user = await createUser({ email: "nocourse2@example.com" });
      const { cookies } = await loginAs(app, "nocourse2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/user/lessons/${courseData.freeLesson.id}/complete`,
        { courseId: "nonexistent" }
      );

      expect(res.statusCode).toBe(404);
    });
  });
});
