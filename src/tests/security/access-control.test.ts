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

describe("BROKEN OBJECT-LEVEL AUTHORIZATION (BOLA/IDOR)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── CROSS-USER DATA ACCESS ───────────────────────────────────

  describe("CROSS-USER DATA ACCESS", () => {
    it("User A cannot see User B's progress (GET /courses/:slug/progress)", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const userA = await createUser({ email: "usera@example.com" });
      const userB = await createUser({ email: "userb@example.com" });

      await createEnrollment(userA.id, courseData.course.id);
      await createEnrollment(userB.id, courseData.course.id);

      // UserB completes a lesson
      await prisma.userLessonProgress.create({
        data: {
          userId: userB.id,
          lessonId: courseData.freeLesson.id,
          completed: true,
          completedAt: new Date(),
          watchedSeconds: 300,
        },
      });

      // UserA checks progress — should only see their own (0 completed)
      const { cookies: cookiesA } = await loginAs(app, "usera@example.com");
      const res = await injectWithAuth(
        app,
        cookiesA,
        "GET",
        "/courses/test-course/progress"
      );

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.courseProgress.completedLessons).toBe(0);
    });

    it("User A's progress endpoint only returns their own data", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const userA = await createUser({ email: "onlya@example.com" });
      const userB = await createUser({ email: "onlyb@example.com" });

      await createEnrollment(userA.id, courseData.course.id);
      await createEnrollment(userB.id, courseData.course.id);

      // Both users have different progress
      await prisma.userLessonProgress.create({
        data: { userId: userA.id, lessonId: courseData.freeLesson.id, watchedSeconds: 100 },
      });
      await prisma.userLessonProgress.create({
        data: { userId: userB.id, lessonId: courseData.freeLesson.id, watchedSeconds: 999 },
      });

      const { cookies: cookiesA } = await loginAs(app, "onlya@example.com");
      const res = await injectWithAuth(
        app,
        cookiesA,
        "GET",
        "/courses/test-course/progress"
      );

      const body = res.json().data;
      const lessonProgress = body.modules[0].lessons[0];
      expect(lessonProgress.watchedSeconds).toBe(100);
      // Should NOT be 999 (User B's data)
      expect(lessonProgress.watchedSeconds).not.toBe(999);
    });

    it("curriculum completion status only shows authenticated user's data", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const userA = await createUser({ email: "sidebara@example.com" });
      const userB = await createUser({ email: "sidebarb@example.com" });

      await createEnrollment(userA.id, courseData.course.id);
      await createEnrollment(userB.id, courseData.course.id);

      // UserB completed free lesson
      await prisma.userLessonProgress.create({
        data: {
          userId: userB.id,
          lessonId: courseData.freeLesson.id,
          completed: true,
          completedAt: new Date(),
        },
      });

      // UserA sees curriculum — should not show B's completion
      const { cookies: cookiesA } = await loginAs(app, "sidebara@example.com");
      const res = await injectWithAuth(
        app,
        cookiesA,
        "GET",
        `/courses/test-course/lessons/${courseData.freeLesson.id}`
      );

      const body = res.json().data;
      const freeLessonInCurriculum = body.curriculum[0].lessons.find(
        (l: any) => l.id === courseData.freeLesson.id
      );
      expect(freeLessonInCurriculum.completed).toBe(false);
    });
  });

  // ─── CROSS-COURSE OBJECT ACCESS ──────────────────────────────

  describe("CROSS-COURSE OBJECT ACCESS", () => {
    it("module from Course A cannot be accessed via /admin/courses/{CourseB}/modules/{moduleA} → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      const courseB = await prisma.course.create({
        data: { title: "Course B", slug: "course-b-idor", isPublished: true },
      });

      const admin = await createUser({ email: "adminidor@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "adminidor@example.com");

      // Try to access Course A's module via Course B's URL
      const res = await injectWithAuth(
        app,
        cookies,
        "PATCH",
        `/admin/courses/${courseB.id}/modules/${courseDataA.module.id}`,
        { title: "Hacked Module" }
      );
      expect(res.statusCode).toBe(404);
    });

    it("lesson from Module A cannot be accessed via /admin/courses/.../modules/{ModuleB}/lessons/{lessonA} → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();

      // Create another module in the same course
      const moduleB = await prisma.module.create({
        data: { courseId: courseDataA.course.id, title: "Module B", order: 2 },
      });

      const admin = await createUser({ email: "adminlesson@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "adminlesson@example.com");

      // Try to access lesson from Module A via Module B's URL
      const res = await injectWithAuth(
        app,
        cookies,
        "PATCH",
        `/admin/courses/${courseDataA.course.id}/modules/${moduleB.id}/lessons/${courseDataA.freeLesson.id}`,
        { title: "Hacked Lesson" }
      );
      expect(res.statusCode).toBe(404);
    });

    it("deleting module from wrong course → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      const courseB = await prisma.course.create({
        data: { title: "Course B2", slug: "course-b2", isPublished: true },
      });

      const admin = await createUser({ email: "admindelmod@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admindelmod@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "DELETE",
        `/admin/courses/${courseB.id}/modules/${courseDataA.module.id}`
      );
      expect(res.statusCode).toBe(404);
    });

    it("deleting lesson from wrong module → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      const moduleB = await prisma.module.create({
        data: { courseId: courseDataA.course.id, title: "Mod B", order: 2 },
      });

      const admin = await createUser({ email: "admindellesson@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admindellesson@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "DELETE",
        `/admin/courses/${courseDataA.course.id}/modules/${moduleB.id}/lessons/${courseDataA.freeLesson.id}`
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PARAMETER TAMPERING ──────────────────────────────────────

  describe("PARAMETER TAMPERING", () => {
    it("lesson endpoint with valid lessonId but wrong course slug → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      await prisma.course.create({
        data: { title: "Course Wrong", slug: "wrong-slug-course", isPublished: true },
      });

      const res = await app.inject({
        method: "GET",
        url: `/courses/wrong-slug-course/lessons/${courseDataA.freeLesson.id}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it("progress POST with mismatched course slug → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      await prisma.course.create({
        data: { title: "Mismatch", slug: "mismatch-course", isPublished: true },
      });

      const user = await createUser({ email: "mismatch@example.com" });
      const { cookies } = await loginAs(app, "mismatch@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/courses/mismatch-course/lessons/${courseDataA.freeLesson.id}/progress`,
        { watchedSeconds: 10 }
      );
      expect(res.statusCode).toBe(404);
    });

    it("admin CRUD: moduleId that doesn't belong to courseId → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      const courseB = await prisma.course.create({
        data: { title: "CB", slug: "cb-course", isPublished: true },
      });

      const admin = await createUser({ email: "admintamp@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admintamp@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "PATCH",
        `/admin/courses/${courseB.id}/modules/${courseDataA.module.id}`,
        { title: "Tampered" }
      );
      expect(res.statusCode).toBe(404);
    });

    it("admin CRUD: lessonId that doesn't belong to moduleId → 404", async () => {
      const courseDataA = await seedCourseWithModulesAndLessons();
      const mod2 = await prisma.module.create({
        data: { courseId: courseDataA.course.id, title: "Mod2", order: 2 },
      });

      const admin = await createUser({ email: "admintamp2@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admintamp2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "PATCH",
        `/admin/courses/${courseDataA.course.id}/modules/${mod2.id}/lessons/${courseDataA.freeLesson.id}`,
        { title: "Tampered Lesson" }
      );
      expect(res.statusCode).toBe(404);
    });
  });
});
