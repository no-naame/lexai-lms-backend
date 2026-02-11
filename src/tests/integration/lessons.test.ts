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

describe("INTEGRATION — LESSON CONTENT DELIVERY", () => {
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

  describe("LESSON CONTENT STRUCTURE", () => {
    it("free lesson returns full lesson object with expected fields", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      const lesson = body.lesson;
      expect(lesson.id).toBe(courseData.freeLesson.id);
      expect(lesson.title).toBe("Free Lesson");
      expect(lesson.type).toBe("video");
      expect(lesson.videoUrl).toBe("https://example.com/free-video.mp4");
      expect(lesson.articleContent).toBe("Free lesson content");
      expect(lesson.content).toBe("Free lesson content");
      expect(lesson.duration).toBe(300);
      expect(lesson.videoDurationMinutes).toBe(5);
      expect(lesson.isFree).toBe(true);
      expect(lesson.courseId).toBe("test-course");
      expect(lesson.moduleId).toBe(courseData.module.id);
    });

    it("lesson response includes module info", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      const body = res.json().data;
      expect(body.module.id).toBe(courseData.module.id);
      expect(body.module.title).toBe("Module 1");
    });

    it("lesson response includes course info with slug as id", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      const body = res.json().data;
      expect(body.course.id).toBe("test-course");
      expect(body.course.slug).toBe("test-course");
      expect(body.course.title).toBe("Test Course");
    });

    it("curriculum replaces sidebar with new structure", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      const body = res.json().data;
      expect(body.curriculum).toBeDefined();
      expect(body.curriculum).toHaveLength(1);
      expect(body.curriculum[0]).toHaveProperty("id");
      expect(body.curriculum[0]).toHaveProperty("title");
      expect(body.curriculum[0].lessons).toHaveLength(2);
      expect(body.curriculum[0].lessons[0]).toHaveProperty("durationMinutes");
      expect(body.curriculum[0].lessons[0].type).toBe("video");
    });

    it("navigation provides enriched prev/next with title and moduleId", async () => {
      const res1 = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      const nav1 = res1.json().data.navigation;
      expect(nav1.previousLesson).toBeNull();
      expect(nav1.nextLesson).toBeDefined();
      expect(nav1.nextLesson.id).toBe(courseData.paidLesson.id);
      expect(nav1.nextLesson).toHaveProperty("title");
      expect(nav1.nextLesson).toHaveProperty("moduleId");
      expect(nav1.currentModule).toBeDefined();
      expect(nav1.currentModule.id).toBe(courseData.module.id);
    });

    it("last lesson has no next", async () => {
      const user = await createUser({ email: "navtest@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "navtest@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      const nav = res.json().data.navigation;
      expect(nav.previousLesson).toBeDefined();
      expect(nav.previousLesson.id).toBe(courseData.freeLesson.id);
      expect(nav.nextLesson).toBeNull();
    });

    it("unauthenticated user gets null progress for free lesson", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      expect(res.json().data.progress).toBeNull();
    });

    it("authenticated user gets progress object", async () => {
      const user = await createUser({ email: "progcheck@example.com" });
      const { cookies } = await loginAs(app, "progcheck@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.freeLesson.id}`
      );

      const progress = res.json().data.progress;
      expect(progress).toHaveProperty("completed");
      expect(progress).toHaveProperty("watchedSeconds");
      expect(progress.completed).toBe(false);
      expect(progress.watchedSeconds).toBe(0);
    });
  });
});
