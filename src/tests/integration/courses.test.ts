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

describe("INTEGRATION — COURSE CATALOG & DETAIL", () => {
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

  // ─── GET /courses (CATALOG) ──────────────────────────────────

  describe("GET /courses (CATALOG)", () => {
    it("returns only published courses", async () => {
      await seedCourseWithModulesAndLessons();
      await prisma.course.create({
        data: { title: "Unpublished", slug: "unpub", isPublished: false },
      });

      const res = await app.inject({ method: "GET", url: "/courses" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.courses).toHaveLength(1);
      expect(body.data.courses[0].slug).toBe("test-course");
    });

    it("does not return unpublished courses", async () => {
      await prisma.course.create({
        data: { title: "Hidden", slug: "hidden", isPublished: false },
      });

      const res = await app.inject({ method: "GET", url: "/courses" });
      expect(res.json().data.courses).toHaveLength(0);
    });

    it("returns totalModules and totalLessons", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses" });
      const course = res.json().data.courses[0];

      expect(course).toHaveProperty("totalModules");
      expect(course).toHaveProperty("totalLessons");
      expect(course.totalModules).toBe(1);
      expect(course.totalLessons).toBe(2);
    });

    it("returns thumbnail", async () => {
      await prisma.course.create({
        data: {
          title: "With Thumb",
          slug: "with-thumb",
          isPublished: true,
          thumbnail: "https://example.com/thumb.jpg",
        },
      });

      const res = await app.inject({ method: "GET", url: "/courses" });
      expect(res.json().data.courses[0].thumbnail).toBe("https://example.com/thumb.jpg");
    });

    it("does NOT return introVideoUrl, content, or videoUrl", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses" });
      const body = res.json();
      const text = JSON.stringify(body);

      expect(text).not.toContain("introVideoUrl");
      expect(text).not.toContain("videoUrl");
      expect(text).not.toContain("free-video.mp4");
    });

    it("works without authentication", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.courses.length).toBeGreaterThan(0);
    });

    it("returns pagination info", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses" });
      const body = res.json();

      expect(body.data.pagination).toBeDefined();
      expect(body.data.pagination.total).toBe(1);
      expect(body.data.pagination).toHaveProperty("limit");
      expect(body.data.pagination).toHaveProperty("offset");
      expect(body.data.pagination).toHaveProperty("hasMore");
    });

    it("uses slug as id", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses" });
      const course = res.json().data.courses[0];
      expect(course.id).toBe("test-course");
    });

    it("returns new fields (category, level, tags, rating, etc.)", async () => {
      await prisma.course.create({
        data: {
          title: "Full Fields",
          slug: "full-fields",
          isPublished: true,
          category: "engineering",
          level: "Intermediate",
          tags: ["tag1", "tag2"],
          studentsCount: 100,
          rating: 4.5,
          reviewsCount: 10,
          isFeatured: true,
        },
      });

      const res = await app.inject({ method: "GET", url: "/courses" });
      const course = res.json().data.courses[0];

      expect(course.category).toBe("engineering");
      expect(course.level).toBe("Intermediate");
      expect(course.tags).toEqual(["tag1", "tag2"]);
      expect(course.studentsCount).toBe(100);
      expect(course.rating).toBe(4.5);
      expect(course.reviewsCount).toBe(10);
      expect(course.isFeatured).toBe(true);
    });

    it("supports search query param", async () => {
      await seedCourseWithModulesAndLessons();
      await prisma.course.create({
        data: { title: "Python Basics", slug: "python-basics", isPublished: true },
      });

      const res = await app.inject({ method: "GET", url: "/courses?search=Python" });
      const courses = res.json().data.courses;
      expect(courses).toHaveLength(1);
      expect(courses[0].slug).toBe("python-basics");
    });

    it("supports limit and offset", async () => {
      await seedCourseWithModulesAndLessons();
      await prisma.course.create({
        data: { title: "Another", slug: "another-course", isPublished: true },
      });

      const res = await app.inject({ method: "GET", url: "/courses?limit=1&offset=0" });
      const body = res.json().data;
      expect(body.courses).toHaveLength(1);
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.hasMore).toBe(true);
    });
  });

  // ─── GET /courses/featured ─────────────────────────────────

  describe("GET /courses/featured", () => {
    it("returns only featured published courses", async () => {
      await prisma.course.create({
        data: { title: "Featured", slug: "featured-1", isPublished: true, isFeatured: true },
      });
      await prisma.course.create({
        data: { title: "Not Featured", slug: "not-featured", isPublished: true, isFeatured: false },
      });

      const res = await app.inject({ method: "GET", url: "/courses/featured" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.courses).toHaveLength(1);
      expect(body.data.courses[0].slug).toBe("featured-1");
    });

    it("returns max 3 courses", async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.course.create({
          data: { title: `Featured ${i}`, slug: `featured-${i}`, isPublished: true, isFeatured: true },
        });
      }

      const res = await app.inject({ method: "GET", url: "/courses/featured" });
      expect(res.json().data.courses.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── GET /courses/:slug (DETAIL) ─────────────────────────────

  describe("GET /courses/:slug (DETAIL)", () => {
    it("returns course and modules as separate keys", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      expect(res.statusCode).toBe(200);

      const body = res.json().data;
      expect(body.course).toBeDefined();
      expect(body.modules).toBeDefined();
      expect(body.modules).toHaveLength(1);
      expect(body.modules[0].lessons).toHaveLength(2);
    });

    it("returns lessonCount and videoCount per module", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      const mod = res.json().data.modules[0];

      expect(mod).toHaveProperty("lessonCount");
      expect(mod).toHaveProperty("videoCount");
      expect(mod.lessonCount).toBe(2);
      expect(mod.videoCount).toBe(2);
    });

    it("uses slug as course id", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      const course = res.json().data.course;
      expect(course.id).toBe("test-course");
    });

    it("lesson type is lowercased", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      const lesson = res.json().data.modules[0].lessons[0];
      expect(lesson.type).toBe("video");
    });

    it("lesson includes videoDurationMinutes", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      const lesson = res.json().data.modules[0].lessons[0];
      expect(lesson).toHaveProperty("videoDurationMinutes");
      expect(lesson.videoDurationMinutes).toBe(Math.round(300 / 60));
    });

    it("lesson metadata does NOT include content or videoUrl", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      const lesson = res.json().data.modules[0].lessons[0];

      expect(lesson).not.toHaveProperty("content");
      expect(lesson).not.toHaveProperty("videoUrl");
    });

    it("returns hasAccess=false when unauthenticated", async () => {
      await seedCourseWithModulesAndLessons();

      const res = await app.inject({ method: "GET", url: "/courses/test-course" });
      expect(res.json().data.hasAccess).toBe(false);
    });

    it("returns hasAccess=true when user has subscription", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "hasaccess@example.com" });
      await createEnrollment(user.id, courseData.course.id);
      const { cookies } = await loginAs(app, "hasaccess@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/courses/test-course");
      expect(res.json().data.hasAccess).toBe(true);
    });

    it("returns hasAccess=false when user has no subscription", async () => {
      await seedCourseWithModulesAndLessons();
      await createUser({ email: "noaccess@example.com" });
      const { cookies } = await loginAs(app, "noaccess@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/courses/test-course");
      expect(res.json().data.hasAccess).toBe(false);
    });

    it("returns 404 for unpublished course", async () => {
      await prisma.course.create({
        data: { title: "Secret", slug: "secret-course", isPublished: false },
      });

      const res = await app.inject({ method: "GET", url: "/courses/secret-course" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for nonexistent slug", async () => {
      const res = await app.inject({ method: "GET", url: "/courses/does-not-exist" });
      expect(res.statusCode).toBe(404);
    });

    it("returns new course detail fields", async () => {
      await prisma.course.create({
        data: {
          title: "Detailed",
          slug: "detailed-course",
          isPublished: true,
          category: "engineering",
          level: "Advanced",
          tags: ["advanced"],
          studentsCount: 500,
          rating: 4.8,
          reviewsCount: 50,
          includes: { videoHours: 10 },
          whatYouWillLearn: ["Topic A", "Topic B"],
          prerequisites: ["Prerequisite 1"],
          isFeatured: true,
        },
      });

      const res = await app.inject({ method: "GET", url: "/courses/detailed-course" });
      const course = res.json().data.course;

      expect(course.category).toBe("engineering");
      expect(course.level).toBe("Advanced");
      expect(course.tags).toEqual(["advanced"]);
      expect(course.studentsCount).toBe(500);
      expect(course.rating).toBe(4.8);
      expect(course.reviewsCount).toBe(50);
      expect(course.includes).toEqual({ videoHours: 10 });
      expect(course.whatYouWillLearn).toEqual(["Topic A", "Topic B"]);
      expect(course.prerequisites).toEqual(["Prerequisite 1"]);
      expect(course.isFeatured).toBe(true);
    });
  });
});
