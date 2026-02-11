import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { optionalAuthenticate } from "../../hooks/auth.js";
import { canAccessLesson } from "../../lib/access.js";
import { updateProgressSchema } from "../../schemas/course.js";

export default async function lessonRoutes(app: FastifyInstance) {
  // GET /courses/:slug/lessons/:lessonId - Get lesson content
  app.get(
    "/:slug/lessons/:lessonId",
    {
      preHandler: [optionalAuthenticate],
      schema: {
        tags: ["Lessons"],
        summary: "Get lesson content",
        description: "Get full lesson content including video URL, article content, curriculum navigation, and progress.",
        params: {
          type: "object",
          required: ["slug", "lessonId"],
          properties: {
            slug: { type: "string", description: "Course URL slug" },
            lessonId: { type: "string", description: "Lesson CUID" },
          },
        },
        response: {
          200: {
            description: "Full lesson content with curriculum, navigation, and progress",
            type: "object",
            additionalProperties: true,
          },
          401: {
            description: "Paid lesson, user not authenticated",
            type: "object",
            properties: { error: { type: "string", example: "Authentication required" } },
          },
          403: {
            description: "Paid lesson, user has no subscription",
            type: "object",
            properties: { error: { type: "string", example: "Subscription required" } },
          },
          404: {
            description: "Lesson not found, course not published, or slug mismatch",
            type: "object",
            properties: { error: { type: "string", example: "Lesson not found" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { slug, lessonId } = request.params as {
        slug: string;
        lessonId: string;
      };
      const userId = request.currentUser?.userId;

      // Verify the lesson belongs to this course (by slug)
      const lesson = await app.prisma.lesson.findUnique({
        where: { id: lessonId },
        include: {
          module: {
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  isPublished: true,
                },
              },
            },
          },
        },
      });

      if (!lesson || !lesson.module.course.isPublished || lesson.module.course.slug !== slug) {
        return reply.status(404).send({ error: "Lesson not found" });
      }

      // Access check
      if (!lesson.isFree) {
        if (!userId) {
          return reply.status(401).send({ error: "Authentication required" });
        }

        const { accessible, reason } = await canAccessLesson(
          app.prisma,
          userId,
          lessonId
        );

        if (!accessible) {
          if (reason === "no_subscription") {
            return reply.status(403).send({ error: "Subscription required" });
          }
          return reply.status(403).send({ error: "Access denied" });
        }
      }

      // Get curriculum data: all modules and lessons for this course
      const courseModules = await app.prisma.module.findMany({
        where: { courseId: lesson.module.course.id },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          order: true,
          lessons: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              type: true,
              isFree: true,
              isPreview: true,
              duration: true,
            },
          },
        },
      });

      // Get progress for all lessons in this course if authenticated
      let progressMap = new Map<string, { completed: boolean }>();
      if (userId) {
        const allLessonIds = courseModules.flatMap((m) =>
          m.lessons.map((l) => l.id)
        );
        const progressRecords = await app.prisma.userLessonProgress.findMany({
          where: {
            userId,
            lessonId: { in: allLessonIds },
          },
          select: { lessonId: true, completed: true },
        });
        for (const p of progressRecords) {
          progressMap.set(p.lessonId, { completed: p.completed });
        }
      }

      // Build curriculum (replaces sidebar)
      const curriculum = courseModules.map((m) => ({
        id: m.id,
        title: m.title,
        order: m.order,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type.toLowerCase(),
          durationMinutes: Math.round(l.duration / 60),
          isPreview: l.isPreview,
          completed: progressMap.get(l.id)?.completed ?? false,
        })),
      }));

      // Build navigation with enriched prev/next
      const allLessonsOrdered = courseModules.flatMap((m) =>
        m.lessons.map((l) => ({ id: l.id, title: l.title, moduleId: m.id }))
      );
      const currentIndex = allLessonsOrdered.indexOf(
        allLessonsOrdered.find((l) => l.id === lessonId)!
      );

      // Find current module
      const currentModuleData = courseModules.find((m) => m.id === lesson.module.id);

      const navigation = {
        previousLesson:
          currentIndex > 0
            ? {
                id: allLessonsOrdered[currentIndex - 1].id,
                title: allLessonsOrdered[currentIndex - 1].title,
                moduleId: allLessonsOrdered[currentIndex - 1].moduleId,
              }
            : null,
        nextLesson:
          currentIndex < allLessonsOrdered.length - 1
            ? {
                id: allLessonsOrdered[currentIndex + 1].id,
                title: allLessonsOrdered[currentIndex + 1].title,
                moduleId: allLessonsOrdered[currentIndex + 1].moduleId,
              }
            : null,
        currentModule: currentModuleData
          ? { id: currentModuleData.id, title: currentModuleData.title }
          : null,
      };

      // Get current user's progress for this lesson
      let progress = null;
      if (userId) {
        const userProgress = await app.prisma.userLessonProgress.findUnique({
          where: {
            userId_lessonId: { userId, lessonId },
          },
          select: { completed: true, watchedSeconds: true },
        });
        progress = userProgress ?? { completed: false, watchedSeconds: 0 };
      }

      return reply.send({
        lesson: {
          id: lesson.id,
          title: lesson.title,
          type: lesson.type.toLowerCase(),
          videoUrl: lesson.videoUrl,
          articleContent: lesson.content,
          content: lesson.content,
          duration: lesson.duration,
          videoDurationMinutes: Math.round(lesson.duration / 60),
          isFree: lesson.isFree,
          isPreview: lesson.isPreview,
          notes: lesson.notes,
          resources: lesson.resources,
          courseId: lesson.module.course.slug,
          moduleId: lesson.module.id,
        },
        module: {
          id: lesson.module.id,
          title: lesson.module.title,
          order: lesson.module.order,
        },
        course: {
          id: lesson.module.course.slug,
          title: lesson.module.course.title,
          slug: lesson.module.course.slug,
        },
        curriculum,
        progress,
        navigation,
      });
    }
  );

  // POST /courses/:slug/lessons/:lessonId/progress - Update lesson progress
  app.post(
    "/:slug/lessons/:lessonId/progress",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Lessons"],
        summary: "Update lesson progress",
        description: "Update progress for a lesson. watchedSeconds only increases (sending a lower value keeps the existing higher value). completedAt is set only on first completion. Both fields are optional — you can send an empty body.",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["slug", "lessonId"],
          properties: {
            slug: { type: "string" },
            lessonId: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            completed: { type: "boolean", description: "Mark lesson as completed" },
            watchedSeconds: { type: "integer", minimum: 0, description: "Video watch time in seconds (only increases)" },
          },
        },
        response: {
          200: {
            description: "Progress updated",
            type: "object",
            additionalProperties: true,
          },
          400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
          401: { description: "Not authenticated", type: "object", properties: { error: { type: "string" } } },
          403: { description: "No subscription", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Lesson not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { slug, lessonId } = request.params as {
        slug: string;
        lessonId: string;
      };
      const userId = request.currentUser!.userId;

      const parsed = updateProgressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }

      // Verify lesson exists and belongs to this course
      const lesson = await app.prisma.lesson.findUnique({
        where: { id: lessonId },
        include: {
          module: {
            include: {
              course: { select: { id: true, slug: true, isPublished: true } },
            },
          },
        },
      });

      if (!lesson || !lesson.module.course.isPublished || lesson.module.course.slug !== slug) {
        return reply.status(404).send({ error: "Lesson not found" });
      }

      // Access check — must have access to track progress
      if (!lesson.isFree) {
        const { accessible, reason } = await canAccessLesson(
          app.prisma,
          userId,
          lessonId
        );
        if (!accessible) {
          if (reason === "no_subscription") {
            return reply.status(403).send({ error: "Subscription required" });
          }
          return reply.status(403).send({ error: "Access denied" });
        }
      }

      const { completed, watchedSeconds } = parsed.data;

      // Get existing progress
      const existing = await app.prisma.userLessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      });

      const updateData: any = {};
      if (completed !== undefined) {
        updateData.completed = completed;
        if (completed && !existing?.completedAt) {
          updateData.completedAt = new Date();
        }
      }
      if (watchedSeconds !== undefined) {
        // Only increase — prevents regression from race conditions
        if (!existing || watchedSeconds > existing.watchedSeconds) {
          updateData.watchedSeconds = watchedSeconds;
        }
      }

      const progress = await app.prisma.userLessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: {
          userId,
          lessonId,
          completed: completed ?? false,
          completedAt: completed ? new Date() : null,
          watchedSeconds: watchedSeconds ?? 0,
        },
        update: updateData,
        select: {
          completed: true,
          completedAt: true,
          watchedSeconds: true,
        },
      });

      return reply.send({ progress });
    }
  );

  // GET /courses/:slug/progress - Get full progress for a course
  app.get(
    "/:slug/progress",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Lessons"],
        summary: "Get course progress",
        description: "Get full progress breakdown for a course.",
        security: [{ cookieAuth: [] }],
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", description: "Course URL slug" },
          },
        },
        response: {
          200: {
            description: "Course progress breakdown",
            type: "object",
            additionalProperties: true,
          },
          401: { description: "Not authenticated", type: "object", properties: { error: { type: "string" } } },
          404: { description: "Course not found", type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const userId = request.currentUser!.userId;

      const course = await app.prisma.course.findUnique({
        where: { slug },
        select: {
          id: true,
          isPublished: true,
          modules: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              lessons: {
                orderBy: { order: "asc" },
                select: {
                  id: true,
                  title: true,
                  type: true,
                },
              },
            },
          },
        },
      });

      if (!course || !course.isPublished) {
        return reply.status(404).send({ error: "Course not found" });
      }

      // Get all progress for this user in this course
      const allLessonIds = course.modules.flatMap((m) =>
        m.lessons.map((l) => l.id)
      );

      const progressRecords = await app.prisma.userLessonProgress.findMany({
        where: {
          userId,
          lessonId: { in: allLessonIds },
        },
        select: {
          lessonId: true,
          completed: true,
          watchedSeconds: true,
        },
      });

      const progressMap = new Map(
        progressRecords.map((p) => [p.lessonId, p])
      );

      const totalLessons = allLessonIds.length;
      const completedLessons = progressRecords.filter(
        (p) => p.completed
      ).length;
      const percentComplete =
        totalLessons > 0
          ? Math.round((completedLessons / totalLessons) * 1000) / 10
          : 0;

      const modules = course.modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map((l) => {
          const p = progressMap.get(l.id);
          return {
            lessonId: l.id,
            title: l.title,
            type: l.type,
            completed: p?.completed ?? false,
            watchedSeconds: p?.watchedSeconds ?? 0,
          };
        }),
      }));

      return reply.send({
        courseProgress: {
          totalLessons,
          completedLessons,
          percentComplete,
        },
        modules,
      });
    }
  );
}
