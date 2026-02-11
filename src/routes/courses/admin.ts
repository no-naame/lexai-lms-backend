import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireRole } from "../../hooks/rbac.js";
import {
  createCourseSchema,
  updateCourseSchema,
  createModuleSchema,
  updateModuleSchema,
  createLessonSchema,
  updateLessonSchema,
  reorderSchema,
} from "../../schemas/course.js";

export default async function adminCourseRoutes(app: FastifyInstance) {
  const adminGuard = [authenticate, requireRole("PLATFORM_ADMIN")];

  // ─── Course CRUD ──────────────────────────────────────────

  // POST /admin/courses - Create course
  app.post(
    "/",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Courses"],
        summary: "Create a course",
        description: "Create a new course. Slug must be unique, lowercase alphanumeric with hyphens only.",
        security: [{ cookieAuth: [] }],
        body: {
          type: "object",
          required: ["title", "slug"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200, example: "Introduction to Machine Learning" },
            slug: { type: "string", pattern: "^[a-z0-9-]+$", example: "intro-to-ml" },
            description: { type: "string", maxLength: 5000, example: "A comprehensive introduction to ML concepts" },
            thumbnail: { type: "string", format: "uri", example: "https://images.example.com/ml-course.jpg" },
            introVideoUrl: { type: "string", format: "uri" },
            price: { type: "number", minimum: 0, example: 49.99 },
            isPublished: { type: "boolean", default: false },
          },
        },
        response: {
          201: { description: "Course created", type: "object", properties: { course: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, slug: { type: "string" }, description: { type: "string", nullable: true }, thumbnail: { type: "string", nullable: true }, introVideoUrl: { type: "string", nullable: true }, price: { type: "number" }, isPublished: { type: "boolean" } } } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" }, details: { type: "object", additionalProperties: true } } },
          401: { description: "Not authenticated", type: "object", properties: { error: { type: "string" } } },
          403: { description: "Not PLATFORM_ADMIN", type: "object", properties: { error: { type: "string" } } },
          409: { description: "Slug already exists", type: "object", properties: { error: { type: "string", example: "Course slug already exists" } } },
        },
      },
    },
    async (request, reply) => {
      const parsed = createCourseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const existing = await app.prisma.course.findUnique({
        where: { slug: parsed.data.slug },
      });
      if (existing) {
        return reply.status(409).send({ error: "Course slug already exists" });
      }

      const course = await app.prisma.course.create({
        data: parsed.data,
      });

      return reply.status(201).send({ course });
    }
  );

  // PATCH /admin/courses/:courseId - Update course
  app.patch(
    "/:courseId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Courses"],
        summary: "Update a course",
        description: "Update an existing course. All fields are optional (partial update). If changing slug, uniqueness is checked.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId"], properties: { courseId: { type: "string", description: "Course CUID" } } },
        body: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 200 },
            slug: { type: "string", pattern: "^[a-z0-9-]+$" },
            description: { type: "string", maxLength: 5000 },
            thumbnail: { type: "string", format: "uri" },
            introVideoUrl: { type: "string", format: "uri" },
            price: { type: "number", minimum: 0 },
            isPublished: { type: "boolean" },
          },
        },
        response: {
          200: { description: "Course updated", type: "object", properties: { course: { type: "object", additionalProperties: true } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Course not found", type: "object", properties: { error: { type: "string" } } },
          409: { description: "Slug conflict", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const parsed = updateCourseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const course = await app.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        return reply.status(404).send({ error: "Course not found" });
      }

      // Check slug uniqueness if slug is being changed
      if (parsed.data.slug && parsed.data.slug !== course.slug) {
        const slugExists = await app.prisma.course.findUnique({
          where: { slug: parsed.data.slug },
        });
        if (slugExists) {
          return reply.status(409).send({ error: "Course slug already exists" });
        }
      }

      const updated = await app.prisma.course.update({
        where: { id: courseId },
        data: parsed.data,
      });

      return reply.send({ course: updated });
    }
  );

  // DELETE /admin/courses/:courseId - Delete course (cascades)
  app.delete(
    "/:courseId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Courses"],
        summary: "Delete a course",
        description: "Delete a course and cascade-delete all its modules, lessons, enrollments, and progress records.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId"], properties: { courseId: { type: "string" } } },
        response: {
          200: { description: "Course deleted", type: "object", properties: { message: { type: "string", example: "Course deleted" } } },
          404: { description: "Course not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };

      const course = await app.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        return reply.status(404).send({ error: "Course not found" });
      }

      await app.prisma.course.delete({ where: { id: courseId } });
      return reply.send({ message: "Course deleted" });
    }
  );

  // ─── Module CRUD ──────────────────────────────────────────

  // POST /admin/courses/:courseId/modules - Create module
  app.post(
    "/:courseId/modules",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Modules"],
        summary: "Create a module",
        description: "Create a module within a course. Order must be a positive integer and unique within the course.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId"], properties: { courseId: { type: "string" } } },
        body: {
          type: "object",
          required: ["title", "order"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200, example: "Getting Started" },
            description: { type: "string", maxLength: 2000 },
            order: { type: "integer", minimum: 1, example: 1 },
          },
        },
        response: {
          201: { description: "Module created", type: "object", properties: { module: { type: "object", properties: { id: { type: "string" }, courseId: { type: "string" }, title: { type: "string" }, description: { type: "string", nullable: true }, order: { type: "integer" } } } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Course not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const parsed = createModuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const course = await app.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        return reply.status(404).send({ error: "Course not found" });
      }

      const module = await app.prisma.module.create({
        data: {
          courseId,
          ...parsed.data,
        },
      });

      return reply.status(201).send({ module });
    }
  );

  // PATCH /admin/courses/:courseId/modules/:moduleId - Update module
  app.patch(
    "/:courseId/modules/:moduleId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Modules"],
        summary: "Update a module",
        description: "Update a module's title, description, or order.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" } } },
        body: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, order: { type: "integer", minimum: 1 } } },
        response: {
          200: { description: "Module updated", type: "object", properties: { module: { type: "object", additionalProperties: true } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Module not found in this course", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId } = request.params as {
        courseId: string;
        moduleId: string;
      };
      const parsed = updateModuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const module = await app.prisma.module.findFirst({
        where: { id: moduleId, courseId },
      });
      if (!module) {
        return reply.status(404).send({ error: "Module not found" });
      }

      const updated = await app.prisma.module.update({
        where: { id: moduleId },
        data: parsed.data,
      });

      return reply.send({ module: updated });
    }
  );

  // DELETE /admin/courses/:courseId/modules/:moduleId - Delete module (cascades)
  app.delete(
    "/:courseId/modules/:moduleId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Modules"],
        summary: "Delete a module",
        description: "Delete a module and cascade-delete all its lessons.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" } } },
        response: {
          200: { description: "Module deleted", type: "object", properties: { message: { type: "string", example: "Module deleted" } } },
          404: { description: "Module not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId } = request.params as {
        courseId: string;
        moduleId: string;
      };

      const module = await app.prisma.module.findFirst({
        where: { id: moduleId, courseId },
      });
      if (!module) {
        return reply.status(404).send({ error: "Module not found" });
      }

      await app.prisma.module.delete({ where: { id: moduleId } });
      return reply.send({ message: "Module deleted" });
    }
  );

  // PATCH /admin/courses/:courseId/modules/reorder - Reorder modules
  app.patch(
    "/:courseId/modules/reorder",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Modules"],
        summary: "Reorder modules",
        description: "Reorder modules within a course. Updates are applied atomically via a database transaction.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId"], properties: { courseId: { type: "string" } } },
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: { type: "array", items: { type: "object", required: ["id", "order"], properties: { id: { type: "string" }, order: { type: "integer", minimum: 1 } } } },
          },
        },
        response: {
          200: { description: "Modules reordered", type: "object", properties: { modules: { type: "array", items: { type: "object", additionalProperties: true } } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Course not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId } = request.params as { courseId: string };
      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const course = await app.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        return reply.status(404).send({ error: "Course not found" });
      }

      // Use a transaction to update all orders atomically
      // First set all to negative values to avoid unique constraint conflicts
      await app.prisma.$transaction(async (tx) => {
        for (const item of parsed.data.items) {
          await tx.module.update({
            where: { id: item.id },
            data: { order: -item.order },
          });
        }
        for (const item of parsed.data.items) {
          await tx.module.update({
            where: { id: item.id },
            data: { order: item.order },
          });
        }
      });

      const modules = await app.prisma.module.findMany({
        where: { courseId },
        orderBy: { order: "asc" },
      });

      return reply.send({ modules });
    }
  );

  // ─── Lesson CRUD ──────────────────────────────────────────

  // POST /admin/courses/:courseId/modules/:moduleId/lessons - Create lesson
  app.post(
    "/:courseId/modules/:moduleId/lessons",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Lessons"],
        summary: "Create a lesson",
        description: "Create a lesson within a module. Supports VIDEO and ARTICLE types. Free lessons are accessible without authentication.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" } } },
        body: {
          type: "object",
          required: ["title", "order"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200, example: "What is Machine Learning?" },
            description: { type: "string", maxLength: 2000 },
            order: { type: "integer", minimum: 1, example: 1 },
            type: { type: "string", enum: ["VIDEO", "ARTICLE"], default: "ARTICLE" },
            isFree: { type: "boolean", default: false, description: "If true, lesson is accessible without subscription" },
            videoUrl: { type: "string", format: "uri", example: "https://vimeo.com/123456789" },
            content: { type: "string", description: "Markdown/HTML article content" },
            duration: { type: "integer", minimum: 0, description: "Duration in seconds", example: 600 },
          },
        },
        response: {
          201: { description: "Lesson created", type: "object", properties: { lesson: { type: "object", properties: { id: { type: "string" }, moduleId: { type: "string" }, title: { type: "string" }, description: { type: "string", nullable: true }, order: { type: "integer" }, type: { type: "string" }, isFree: { type: "boolean" }, videoUrl: { type: "string", nullable: true }, content: { type: "string", nullable: true }, duration: { type: "integer" } } } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Module not found in this course", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId } = request.params as {
        courseId: string;
        moduleId: string;
      };
      const parsed = createLessonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const module = await app.prisma.module.findFirst({
        where: { id: moduleId, courseId },
      });
      if (!module) {
        return reply.status(404).send({ error: "Module not found" });
      }

      const lesson = await app.prisma.lesson.create({
        data: {
          moduleId,
          ...parsed.data,
        },
      });

      return reply.status(201).send({ lesson });
    }
  );

  // PATCH /admin/courses/:courseId/modules/:moduleId/lessons/:lessonId - Update lesson
  app.patch(
    "/:courseId/modules/:moduleId/lessons/:lessonId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Lessons"],
        summary: "Update a lesson",
        description: "Update a lesson's properties. All fields are optional.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId", "lessonId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" }, lessonId: { type: "string" } } },
        body: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, order: { type: "integer" }, type: { type: "string", enum: ["VIDEO", "ARTICLE"] }, isFree: { type: "boolean" }, videoUrl: { type: "string" }, content: { type: "string" }, duration: { type: "integer" } } },
        response: {
          200: { description: "Lesson updated", type: "object", properties: { lesson: { type: "object", additionalProperties: true } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Lesson not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId, lessonId } = request.params as {
        courseId: string;
        moduleId: string;
        lessonId: string;
      };
      const parsed = updateLessonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const lesson = await app.prisma.lesson.findFirst({
        where: { id: lessonId, moduleId, module: { courseId } },
      });
      if (!lesson) {
        return reply.status(404).send({ error: "Lesson not found" });
      }

      const updated = await app.prisma.lesson.update({
        where: { id: lessonId },
        data: parsed.data,
      });

      return reply.send({ lesson: updated });
    }
  );

  // DELETE /admin/courses/:courseId/modules/:moduleId/lessons/:lessonId - Delete lesson
  app.delete(
    "/:courseId/modules/:moduleId/lessons/:lessonId",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Lessons"],
        summary: "Delete a lesson",
        description: "Delete a lesson and its associated progress records.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId", "lessonId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" }, lessonId: { type: "string" } } },
        response: {
          200: { description: "Lesson deleted", type: "object", properties: { message: { type: "string", example: "Lesson deleted" } } },
          404: { description: "Lesson not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId, lessonId } = request.params as {
        courseId: string;
        moduleId: string;
        lessonId: string;
      };

      const lesson = await app.prisma.lesson.findFirst({
        where: { id: lessonId, moduleId, module: { courseId } },
      });
      if (!lesson) {
        return reply.status(404).send({ error: "Lesson not found" });
      }

      await app.prisma.lesson.delete({ where: { id: lessonId } });
      return reply.send({ message: "Lesson deleted" });
    }
  );

  // PATCH /admin/courses/:courseId/modules/:moduleId/lessons/reorder - Reorder lessons
  app.patch(
    "/:courseId/modules/:moduleId/lessons/reorder",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["Admin - Lessons"],
        summary: "Reorder lessons",
        description: "Reorder lessons within a module. Updates are applied atomically via a database transaction.",
        security: [{ cookieAuth: [] }],
        params: { type: "object", required: ["courseId", "moduleId"], properties: { courseId: { type: "string" }, moduleId: { type: "string" } } },
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: { type: "array", items: { type: "object", required: ["id", "order"], properties: { id: { type: "string" }, order: { type: "integer", minimum: 1 } } } },
          },
        },
        response: {
          200: { description: "Lessons reordered", type: "object", properties: { lessons: { type: "array", items: { type: "object", additionalProperties: true } } } },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Module not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { courseId, moduleId } = request.params as {
        courseId: string;
        moduleId: string;
      };
      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const module = await app.prisma.module.findFirst({
        where: { id: moduleId, courseId },
      });
      if (!module) {
        return reply.status(404).send({ error: "Module not found" });
      }

      // Use a transaction to update all orders atomically
      await app.prisma.$transaction(async (tx) => {
        for (const item of parsed.data.items) {
          await tx.lesson.update({
            where: { id: item.id },
            data: { order: -item.order },
          });
        }
        for (const item of parsed.data.items) {
          await tx.lesson.update({
            where: { id: item.id },
            data: { order: item.order },
          });
        }
      });

      const lessons = await app.prisma.lesson.findMany({
        where: { moduleId },
        orderBy: { order: "asc" },
      });

      return reply.send({ lessons });
    }
  );
}
