import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  loginAs,
  injectWithAuth,
  prisma,
} from "../helpers.js";

describe("INTEGRATION — ADMIN CRUD", () => {
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

  // ─── COURSE CRUD ──────────────────────────────────────────────

  describe("COURSE CRUD", () => {
    it("create course with all fields → 201", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Full Course",
        slug: "full-course",
        description: "A course with all fields",
        thumbnail: "https://example.com/thumb.jpg",
        introVideoUrl: "https://example.com/intro.mp4",
        price: 49.99,
        isPublished: true,
      });

      expect(res.statusCode).toBe(201);
      const course = res.json().course;
      expect(course.title).toBe("Full Course");
      expect(course.slug).toBe("full-course");
      expect(course.price).toBe(49.99);
      expect(course.isPublished).toBe(true);
    });

    it("create course with minimal fields → 201", async () => {
      const res = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Minimal",
        slug: "minimal-course",
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().course.title).toBe("Minimal");
    });

    it("update course title → 200", async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Original",
        slug: "original-course",
      });
      const courseId = createRes.json().course.id;

      const res = await injectWithAuth(app, adminCookies, "PATCH", `/admin/courses/${courseId}`, {
        title: "Updated Title",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().course.title).toBe("Updated Title");
    });

    it("update course slug (unique check) → 200 or 409", async () => {
      const c1 = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Course 1",
        slug: "course-1",
      });
      await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Course 2",
        slug: "course-2",
      });

      // Update course 1's slug to a unique slug → 200
      const res1 = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${c1.json().course.id}`,
        { slug: "course-1-new" }
      );
      expect(res1.statusCode).toBe(200);

      // Try to update to existing slug → 409
      const res2 = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${c1.json().course.id}`,
        { slug: "course-2" }
      );
      expect(res2.statusCode).toBe(409);
    });

    it("delete course → cascades modules and lessons", async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "To Delete",
        slug: "to-delete",
      });
      const courseId = createRes.json().course.id;

      // Create module and lesson
      const modRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Module", order: 1 }
      );
      const moduleId = modRes.json().module.id;

      await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Lesson", order: 1 }
      );

      // Delete course
      const delRes = await injectWithAuth(app, adminCookies, "DELETE", `/admin/courses/${courseId}`);
      expect(delRes.statusCode).toBe(200);

      // Verify cascaded deletion
      const modules = await prisma.module.findMany({ where: { courseId } });
      expect(modules).toHaveLength(0);
    });

    it("deleted course no longer appears in catalog", async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Will Delete",
        slug: "will-delete",
        isPublished: true,
      });
      const courseId = createRes.json().course.id;

      await injectWithAuth(app, adminCookies, "DELETE", `/admin/courses/${courseId}`);

      const catalogRes = await app.inject({ method: "GET", url: "/courses" });
      const slugs = catalogRes.json().data.courses.map((c: any) => c.slug);
      expect(slugs).not.toContain("will-delete");
    });
  });

  // ─── MODULE CRUD ──────────────────────────────────────────────

  describe("MODULE CRUD", () => {
    let courseId: string;

    beforeEach(async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Module Course",
        slug: "module-course",
      });
      courseId = createRes.json().course.id;
    });

    it("create module in course → 201", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "New Module", order: 1 }
      );

      expect(res.statusCode).toBe(201);
      expect(res.json().module.title).toBe("New Module");
      expect(res.json().module.courseId).toBe(courseId);
    });

    it("update module title → 200", async () => {
      const modRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Original", order: 1 }
      );
      const moduleId = modRes.json().module.id;

      const res = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${courseId}/modules/${moduleId}`,
        { title: "Updated Module" }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().module.title).toBe("Updated Module");
    });

    it("delete module → cascades lessons", async () => {
      const modRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "To Delete", order: 1 }
      );
      const moduleId = modRes.json().module.id;

      await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Lesson", order: 1 }
      );

      const res = await injectWithAuth(
        app,
        adminCookies,
        "DELETE",
        `/admin/courses/${courseId}/modules/${moduleId}`
      );
      expect(res.statusCode).toBe(200);

      const lessons = await prisma.lesson.findMany({ where: { moduleId } });
      expect(lessons).toHaveLength(0);
    });

    it("reorder modules → orders updated atomically", async () => {
      const mod1Res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "First", order: 1 }
      );
      const mod2Res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules`,
        { title: "Second", order: 2 }
      );

      const mod1Id = mod1Res.json().module.id;
      const mod2Id = mod2Res.json().module.id;

      const res = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${courseId}/modules/reorder`,
        {
          items: [
            { id: mod1Id, order: 2 },
            { id: mod2Id, order: 1 },
          ],
        }
      );

      expect(res.statusCode).toBe(200);
      const modules = res.json().modules;
      expect(modules[0].id).toBe(mod2Id);
      expect(modules[0].order).toBe(1);
      expect(modules[1].id).toBe(mod1Id);
      expect(modules[1].order).toBe(2);
    });
  });

  // ─── LESSON CRUD ─────────────────────────────────────────────

  describe("LESSON CRUD", () => {
    let courseId: string;
    let moduleId: string;

    beforeEach(async () => {
      const createRes = await injectWithAuth(app, adminCookies, "POST", "/admin/courses", {
        title: "Lesson Course",
        slug: "lesson-course",
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

    it("create VIDEO lesson with videoUrl → 201", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        {
          title: "Video Lesson",
          order: 1,
          type: "VIDEO",
          videoUrl: "https://example.com/video.mp4",
          duration: 600,
        }
      );

      expect(res.statusCode).toBe(201);
      expect(res.json().lesson.type).toBe("VIDEO");
      expect(res.json().lesson.videoUrl).toBe("https://example.com/video.mp4");
    });

    it("create ARTICLE lesson with content → 201", async () => {
      const res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        {
          title: "Article Lesson",
          order: 1,
          type: "ARTICLE",
          content: "# Article content\n\nSome markdown here.",
        }
      );

      expect(res.statusCode).toBe(201);
      expect(res.json().lesson.type).toBe("ARTICLE");
      expect(res.json().lesson.content).toContain("Article content");
    });

    it("update lesson type from ARTICLE to VIDEO → 200", async () => {
      const createRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Article", order: 1, type: "ARTICLE", content: "Some text" }
      );
      const lessonId = createRes.json().lesson.id;

      const res = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`,
        { type: "VIDEO", videoUrl: "https://example.com/video.mp4" }
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().lesson.type).toBe("VIDEO");
    });

    it("delete lesson → progress records also deleted", async () => {
      const createRes = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "To Delete", order: 1 }
      );
      const lessonId = createRes.json().lesson.id;

      // Create progress for this lesson
      const user = await createUser({ email: "delprog@example.com" });
      await prisma.userLessonProgress.create({
        data: { userId: user.id, lessonId, watchedSeconds: 100 },
      });

      const res = await injectWithAuth(
        app,
        adminCookies,
        "DELETE",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`
      );
      expect(res.statusCode).toBe(200);

      const progress = await prisma.userLessonProgress.findMany({
        where: { lessonId },
      });
      expect(progress).toHaveLength(0);
    });

    it("reorder lessons → orders updated atomically", async () => {
      const l1Res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "First", order: 1 }
      );
      const l2Res = await injectWithAuth(
        app,
        adminCookies,
        "POST",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons`,
        { title: "Second", order: 2 }
      );

      const l1Id = l1Res.json().lesson.id;
      const l2Id = l2Res.json().lesson.id;

      const res = await injectWithAuth(
        app,
        adminCookies,
        "PATCH",
        `/admin/courses/${courseId}/modules/${moduleId}/lessons/reorder`,
        {
          items: [
            { id: l1Id, order: 2 },
            { id: l2Id, order: 1 },
          ],
        }
      );

      expect(res.statusCode).toBe(200);
      const lessons = res.json().lessons;
      expect(lessons[0].id).toBe(l2Id);
      expect(lessons[0].order).toBe(1);
      expect(lessons[1].id).toBe(l1Id);
      expect(lessons[1].order).toBe(2);
    });
  });
});
