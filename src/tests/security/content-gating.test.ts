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
  createOrganization,
  createOrgMember,
  prisma,
} from "../helpers.js";

describe("CONTENT GATING — Premium Access Control", () => {
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

  // ─── FREE LESSON ACCESS ──────────────────────────────────────

  describe("FREE LESSON ACCESS", () => {
    it("unauthenticated user can access free lesson (isFree=true) → 200 with content+videoUrl", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.lesson.videoUrl).toBe("https://example.com/free-video.mp4");
      expect(body.lesson.articleContent).toBe("Free lesson content");
    });

    it("authenticated user without subscription can access free lesson → 200", async () => {
      const user = await createUser({ email: "free@example.com" });
      const { cookies } = await loginAs(app, "free@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.freeLesson.id}`
      );

      expect(res.statusCode).toBe(200);
    });

    it("authenticated user with subscription can access free lesson → 200", async () => {
      const user = await createUser({ email: "sub@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "sub@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.freeLesson.id}`
      );

      expect(res.statusCode).toBe(200);
    });

    it("free lesson response includes videoUrl and articleContent fields", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      const body = res.json().data;
      expect(body.lesson).toHaveProperty("videoUrl");
      expect(body.lesson).toHaveProperty("articleContent");
      expect(body.lesson.videoUrl).toBeTruthy();
    });
  });

  // ─── PAID LESSON — UNAUTHENTICATED ───────────────────────────

  describe("PAID LESSON — UNAUTHENTICATED", () => {
    it("unauthenticated user accessing paid lesson → 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.paidLesson.id}`,
      });

      expect(res.statusCode).toBe(401);
    });

    it("response body does NOT contain videoUrl or content", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.paidLesson.id}`,
      });

      const body = res.json();
      // With the wrapper, error responses have { success: false, error: {...} }
      expect(body).not.toHaveProperty("lesson");
      expect(body.videoUrl).toBeUndefined();
      expect(body.content).toBeUndefined();
    });

    it("response body does NOT leak lesson content in any field", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.paidLesson.id}`,
      });

      const text = res.body;
      expect(text).not.toContain("paid-video.mp4");
      expect(text).not.toContain("Paid lesson premium content");
    });
  });

  // ─── PAID LESSON — AUTHENTICATED WITHOUT SUBSCRIPTION ────────

  describe("PAID LESSON — AUTHENTICATED WITHOUT SUBSCRIPTION", () => {
    it("user with no enrollment accessing paid lesson → 403", async () => {
      await createUser({ email: "nosub@example.com" });
      const { cookies } = await loginAs(app, "nosub@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toMatch(/subscription required/i);
    });

    it("response body does NOT contain videoUrl or content", async () => {
      await createUser({ email: "nosub2@example.com" });
      const { cookies } = await loginAs(app, "nosub2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      const body = res.json();
      expect(body).not.toHaveProperty("lesson");
      expect(body.videoUrl).toBeUndefined();
      expect(body.content).toBeUndefined();
    });

    it("user who was enrolled but enrollment was deleted → 403", async () => {
      const user = await createUser({ email: "exenrolled@example.com" });
      const enrollment = await createEnrollment(user.id, courseData.course.id);
      // Now delete the enrollment
      await prisma.courseEnrollment.delete({ where: { id: enrollment.id } });

      const { cookies } = await loginAs(app, "exenrolled@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(403);
    });
  });

  // ─── PAID LESSON — AUTHENTICATED WITH SUBSCRIPTION ────────────

  describe("PAID LESSON — AUTHENTICATED WITH SUBSCRIPTION", () => {
    it("user with direct CourseEnrollment can access paid lesson → 200", async () => {
      const user = await createUser({ email: "enrolled@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "enrolled@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.lesson.videoUrl).toBe("https://example.com/paid-video.mp4");
      expect(body.lesson.articleContent).toBe("Paid lesson premium content");
    });

    it("user with INDIVIDUAL enrollment can access → 200", async () => {
      const user = await createUser({ email: "individual@example.com" });
      await createEnrollment(user.id, courseData.course.id, "INDIVIDUAL");
      const { cookies } = await loginAs(app, "individual@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(200);
    });

    it("user with INSTITUTION enrollment can access → 200", async () => {
      const user = await createUser({ email: "instuser@example.com" });
      await createEnrollment(user.id, courseData.course.id, "INSTITUTION");
      const { cookies } = await loginAs(app, "instuser@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(200);
    });

    it("verified org member (no explicit enrollment) can access → 200", async () => {
      const user = await createUser({ email: "orgmember@testuni.edu" });
      const org = await createOrganization({});
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
      });
      const { cookies } = await loginAs(app, "orgmember@testuni.edu");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(200);
    });

    it("response includes videoUrl, articleContent, curriculum, navigation, progress", async () => {
      const user = await createUser({ email: "full@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "full@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      const body = res.json().data;
      expect(body.lesson.videoUrl).toBeDefined();
      expect(body.lesson.articleContent).toBeDefined();
      expect(body.curriculum).toBeDefined();
      expect(body.navigation).toBeDefined();
      expect(body.progress).toBeDefined();
    });
  });

  // ─── EDGE CASES — CONTENT GATING ─────────────────────────────

  describe("EDGE CASES — CONTENT GATING", () => {
    it("lesson in unpublished course → 404 (even if user has enrollment)", async () => {
      const unpubCourse = await prisma.course.create({
        data: { title: "Unpub", slug: "unpub-course", isPublished: false },
      });
      const mod = await prisma.module.create({
        data: { courseId: unpubCourse.id, title: "M1", order: 1 },
      });
      const lesson = await prisma.lesson.create({
        data: { moduleId: mod.id, title: "L1", order: 1, isFree: false },
      });

      const user = await createUser({ email: "unpub@example.com" });
      await createEnrollment(user.id, unpubCourse.id);
      const { cookies } = await loginAs(app, "unpub@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/unpub-course/lessons/${lesson.id}`
      );

      expect(res.statusCode).toBe(404);
    });

    it("lesson ID valid but wrong course slug → 404", async () => {
      const otherCourse = await prisma.course.create({
        data: { title: "Other", slug: "other-course", isPublished: true },
      });

      const res = await app.inject({
        method: "GET",
        url: `/courses/other-course/lessons/${courseData.freeLesson.id}`,
      });

      expect(res.statusCode).toBe(404);
    });

    it("nonexistent lessonId → 404 (not 500)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/nonexistent-id-12345`,
      });

      expect(res.statusCode).toBe(404);
    });

    it("org member whose org was deactivated → 403", async () => {
      const user = await createUser({ email: "deactivatedorg@testuni.edu" });
      const org = await createOrganization({ isActive: false, slug: "deact-org", emailDomains: ["deactorg.edu"] });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
      });
      const { cookies } = await loginAs(app, "deactivatedorg@testuni.edu");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(403);
    });

    it("org member whose membership was set inactive → 403", async () => {
      const user = await createUser({ email: "inactivemember@testuni.edu" });
      const org = await createOrganization({ slug: "inactive-org", emailDomains: ["inactiveorg.edu"] });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: false,
      });
      const { cookies } = await loginAs(app, "inactivemember@testuni.edu");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(403);
    });

    it("org member whose membership is unverified → 403", async () => {
      const user = await createUser({ email: "unverified@testuni.edu" });
      const org = await createOrganization({ slug: "unverif-org", emailDomains: ["unveriforg.edu"] });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: false,
      });
      const { cookies } = await loginAs(app, "unverified@testuni.edu");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/test-course/lessons/${courseData.paidLesson.id}`
      );

      expect(res.statusCode).toBe(403);
    });

    it("enrollment in unpublished course does not grant access to its lessons", async () => {
      const unpubCourse = await prisma.course.create({
        data: { title: "Private", slug: "private-course", isPublished: false },
      });
      const mod = await prisma.module.create({
        data: { courseId: unpubCourse.id, title: "M1", order: 1 },
      });
      const lesson = await prisma.lesson.create({
        data: { moduleId: mod.id, title: "L1", order: 1, isFree: false },
      });

      const user = await createUser({ email: "hasenroll@example.com" });
      await createEnrollment(user.id, unpubCourse.id);
      const { cookies } = await loginAs(app, "hasenroll@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/private-course/lessons/${lesson.id}`
      );

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── CROSS-COURSE ISOLATION ───────────────────────────────────

  describe("CROSS-COURSE ISOLATION", () => {
    it("user enrolled in Course A cannot use that enrollment to access Course B lessons (org member behavior documented)", async () => {
      const courseB = await prisma.course.create({
        data: { title: "Course B", slug: "course-b", isPublished: true },
      });
      const modB = await prisma.module.create({
        data: { courseId: courseB.id, title: "ModB", order: 1 },
      });
      const lessonB = await prisma.lesson.create({
        data: { moduleId: modB.id, title: "LessonB", order: 1, isFree: false },
      });

      const user = await createUser({ email: "crosscourse@example.com" });
      // Enrolled in Course A only
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "crosscourse@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "GET",
        `/courses/course-b/lessons/${lessonB.id}`
      );

      // Without org membership, course A enrollment does NOT grant course B access
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── VIDEO URL PROTECTION ────────────────────────────────────

  describe("VIDEO URL PROTECTION", () => {
    it("GET /courses/:slug (public detail) does NOT return videoUrl in lesson metadata", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/courses/test-course",
      });

      const body = res.json().data;
      const lessons = body.modules.flatMap((m: any) => m.lessons);
      for (const lesson of lessons) {
        expect(lesson).not.toHaveProperty("videoUrl");
        expect(lesson).not.toHaveProperty("content");
      }
    });

    it("GET /courses (catalog) does NOT return any videoUrl or content", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/courses",
      });

      const body = res.json();
      const text = JSON.stringify(body);
      expect(text).not.toContain("videoUrl");
      expect(text).not.toContain("free-video.mp4");
      expect(text).not.toContain("paid-video.mp4");
    });

    it("only GET /courses/:slug/lessons/:lessonId returns videoUrl (after access check passes)", async () => {
      // Free lesson should return videoUrl
      const res = await app.inject({
        method: "GET",
        url: `/courses/test-course/lessons/${courseData.freeLesson.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.lesson.videoUrl).toBe("https://example.com/free-video.mp4");
    });
  });
});
