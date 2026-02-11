import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Compute course progress for a user.
 */
async function computeCourseProgress(
  prisma: PrismaClient,
  userId: string,
  courseId: string
) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      modules: {
        select: {
          lessons: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!course) {
    return { progressPercentage: 0, completedLessons: 0, totalLessons: 0 };
  }

  const allLessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const totalLessons = allLessonIds.length;

  if (totalLessons === 0) {
    return { progressPercentage: 0, completedLessons: 0, totalLessons: 0 };
  }

  const completedCount = await prisma.userLessonProgress.count({
    where: {
      userId,
      lessonId: { in: allLessonIds },
      completed: true,
    },
  });

  const progressPercentage = Math.round((completedCount / totalLessons) * 100);

  return { progressPercentage, completedLessons: completedCount, totalLessons };
}

export default async function userRoutes(app: FastifyInstance) {
  // All user routes require authentication
  app.addHook("preHandler", authenticate);

  // ─── GET /user/enrollments ──────────────────────────────────
  app.get("/enrollments", {
    schema: {
      tags: ["User"],
      summary: "List user enrollments",
      description: "List all courses the authenticated user is enrolled in, with progress info.",
      security: [{ cookieAuth: [] }],
      response: {
        200: {
          description: "User enrollments",
          type: "object",
          additionalProperties: true,
        },
        401: {
          description: "Not authenticated",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.currentUser!.userId;

    const enrollments = await app.prisma.courseEnrollment.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            shortDescription: true,
            thumbnail: true,
            category: true,
            level: true,
            modules: {
              select: {
                lessons: {
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    // Get completed lesson IDs for all enrolled courses
    const allLessonIds = enrollments.flatMap((e) =>
      e.course.modules.flatMap((m) => m.lessons.map((l) => l.id))
    );

    const completedProgress = await app.prisma.userLessonProgress.findMany({
      where: {
        userId,
        lessonId: { in: allLessonIds },
        completed: true,
      },
      select: { lessonId: true },
    });

    const completedLessonIds = new Set(completedProgress.map((p) => p.lessonId));

    const result = enrollments.map((e) => {
      const courseLessonIds = e.course.modules.flatMap((m) =>
        m.lessons.map((l) => l.id)
      );
      const completedInCourse = courseLessonIds.filter((id) => completedLessonIds.has(id));

      return {
        courseId: e.course.slug,
        title: e.course.title,
        slug: e.course.slug,
        description: e.course.shortDescription ?? e.course.description,
        thumbnail: e.course.thumbnail,
        category: e.course.category,
        level: e.course.level,
        enrolledAt: e.createdAt,
        status: e.status,
        progressPercentage: e.progressPercentage,
        completedLessons: completedInCourse.length,
        totalLessons: courseLessonIds.length,
        lastAccessedAt: e.lastAccessedAt,
        accessSource: e.accessSource,
      };
    });

    return reply.send({ enrollments: result });
  });

  // ─── GET /user/enrollments/:courseId ────────────────────────
  app.get("/enrollments/:courseId", {
    schema: {
      tags: ["User"],
      summary: "Get enrollment progress for a course",
      description: "Get detailed progress for a specific enrolled course. courseId is the course slug.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", description: "Course slug" },
        },
      },
      response: {
        200: {
          description: "Course enrollment progress",
          type: "object",
          additionalProperties: true,
        },
        404: {
          description: "Enrollment not found",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.currentUser!.userId;
    const { courseId: courseSlug } = request.params as { courseId: string };

    const course = await app.prisma.course.findUnique({
      where: { slug: courseSlug },
      select: {
        id: true,
        title: true,
        slug: true,
        modules: {
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
                duration: true,
              },
            },
          },
        },
      },
    });

    if (!course) {
      return reply.status(404).send({ error: "Course not found" });
    }

    const enrollment = await app.prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId: course.id },
      },
    });

    if (!enrollment) {
      return reply.status(404).send({ error: "Not enrolled in this course" });
    }

    // Get all lesson progress
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
        completedAt: true,
      },
    });

    const progressMap = new Map(
      progressRecords.map((p) => [p.lessonId, p])
    );

    const totalLessons = allLessonIds.length;
    const completedLessons = progressRecords.filter((p) => p.completed).length;

    const modules = course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      order: m.order,
      lessons: m.lessons.map((l) => {
        const p = progressMap.get(l.id);
        return {
          id: l.id,
          title: l.title,
          type: l.type.toLowerCase(),
          durationMinutes: Math.round(l.duration / 60),
          isCompleted: p?.completed ?? false,
          watchedSeconds: p?.watchedSeconds ?? 0,
          completedAt: p?.completedAt ?? null,
        };
      }),
    }));

    return reply.send({
      courseId: course.slug,
      title: course.title,
      status: enrollment.status,
      progressPercentage: enrollment.progressPercentage,
      completedLessons,
      totalLessons,
      enrolledAt: enrollment.createdAt,
      lastAccessedAt: enrollment.lastAccessedAt,
      modules,
    });
  });

  // ─── POST /user/enrollments/:courseId ───────────────────────
  app.post("/enrollments/:courseId", {
    schema: {
      tags: ["User"],
      summary: "Enroll in a course",
      description: "Enroll the authenticated user in a course. courseId is the course slug.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", description: "Course slug" },
        },
      },
      response: {
        201: {
          description: "Successfully enrolled",
          type: "object",
          additionalProperties: true,
        },
        403: {
          description: "Payment required",
          type: "object",
          properties: { error: { type: "string" } },
        },
        404: {
          description: "Course not found",
          type: "object",
          properties: { error: { type: "string" } },
        },
        409: {
          description: "Already enrolled",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.currentUser!.userId;
    const { courseId: courseSlug } = request.params as { courseId: string };

    const course = await app.prisma.course.findUnique({
      where: { slug: courseSlug },
      select: { id: true, slug: true, title: true, isPublished: true },
    });

    if (!course || !course.isPublished) {
      return reply.status(404).send({ error: "Course not found" });
    }

    // Gate enrollment behind payment (PLATFORM_ADMIN bypasses)
    if (request.currentUser!.role !== "PLATFORM_ADMIN") {
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true },
      });

      if (!user?.isPremium) {
        // Check if user has institutional access
        const membership = await app.prisma.organizationMember.findFirst({
          where: {
            userId,
            isActive: true,
            isVerified: true,
            organization: { isActive: true },
          },
        });

        if (!membership) {
          return reply
            .status(403)
            .send({ error: "Payment required to access courses" });
        }
      }
    }

    // Check if already enrolled
    const existing = await app.prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId: course.id },
      },
    });

    if (existing) {
      return reply.status(409).send({ error: "Already enrolled in this course" });
    }

    // Create enrollment and increment students count
    const [enrollment] = await app.prisma.$transaction([
      app.prisma.courseEnrollment.create({
        data: {
          userId,
          courseId: course.id,
          accessSource: "INDIVIDUAL",
          status: "not-started",
        },
      }),
      app.prisma.course.update({
        where: { id: course.id },
        data: { studentsCount: { increment: 1 } },
      }),
    ]);

    return reply.status(201).send({
      enrollment: {
        courseId: course.slug,
        title: course.title,
        status: enrollment.status,
        enrolledAt: enrollment.createdAt,
        progressPercentage: 0,
      },
    });
  });

  // ─── PUT /user/lessons/:lessonId/progress ───────────────────
  app.put("/lessons/:lessonId/progress", {
    schema: {
      tags: ["User"],
      summary: "Update lesson progress",
      description: "Update watch progress for a lesson.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["lessonId"],
        properties: {
          lessonId: { type: "string", description: "Lesson CUID" },
        },
      },
      body: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", description: "Course slug" },
          watchedSeconds: { type: "integer", minimum: 0 },
        },
      },
      response: {
        200: {
          description: "Progress updated",
          type: "object",
          additionalProperties: true,
        },
        404: {
          description: "Lesson or course not found",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.currentUser!.userId;
    const { lessonId } = request.params as { lessonId: string };
    const { courseId: courseSlug, watchedSeconds } = request.body as {
      courseId: string;
      watchedSeconds?: number;
    };

    // Verify lesson exists and belongs to this course
    const course = await app.prisma.course.findUnique({
      where: { slug: courseSlug },
      select: { id: true },
    });

    if (!course) {
      return reply.status(404).send({ error: "Course not found" });
    }

    const lesson = await app.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          select: { courseId: true },
        },
      },
    });

    if (!lesson || lesson.module.courseId !== course.id) {
      return reply.status(404).send({ error: "Lesson not found" });
    }

    // Get existing progress
    const existing = await app.prisma.userLessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });

    const updateData: any = {};
    if (watchedSeconds !== undefined) {
      if (!existing || watchedSeconds > existing.watchedSeconds) {
        updateData.watchedSeconds = watchedSeconds;
      }
    }

    const progress = await app.prisma.userLessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId,
        lessonId,
        watchedSeconds: watchedSeconds ?? 0,
      },
      update: updateData,
      select: {
        completed: true,
        watchedSeconds: true,
        completedAt: true,
      },
    });

    // Update enrollment's lastAccessedAt and currentLessonId
    await app.prisma.courseEnrollment.updateMany({
      where: { userId, courseId: course.id },
      data: {
        lastAccessedAt: new Date(),
        currentLessonId: lessonId,
        status: "in-progress",
      },
    });

    return reply.send({
      progress: {
        isCompleted: progress.completed,
        watchedSeconds: progress.watchedSeconds,
        completedAt: progress.completedAt,
      },
    });
  });

  // ─── POST /user/lessons/:lessonId/complete ──────────────────
  app.post("/lessons/:lessonId/complete", {
    schema: {
      tags: ["User"],
      summary: "Mark lesson as complete",
      description: "Mark a lesson as completed and recompute course progress.",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        required: ["lessonId"],
        properties: {
          lessonId: { type: "string", description: "Lesson CUID" },
        },
      },
      body: {
        type: "object",
        required: ["courseId"],
        properties: {
          courseId: { type: "string", description: "Course slug" },
        },
      },
      response: {
        200: {
          description: "Lesson marked as complete",
          type: "object",
          additionalProperties: true,
        },
        404: {
          description: "Lesson or course not found",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.currentUser!.userId;
    const { lessonId } = request.params as { lessonId: string };
    const { courseId: courseSlug } = request.body as { courseId: string };

    // Verify course and lesson
    const course = await app.prisma.course.findUnique({
      where: { slug: courseSlug },
      select: { id: true },
    });

    if (!course) {
      return reply.status(404).send({ error: "Course not found" });
    }

    const lesson = await app.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          select: { courseId: true },
        },
      },
    });

    if (!lesson || lesson.module.courseId !== course.id) {
      return reply.status(404).send({ error: "Lesson not found" });
    }

    // Get existing progress to preserve completedAt
    const existing = await app.prisma.userLessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });

    const completedAt = existing?.completedAt ?? new Date();

    await app.prisma.userLessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId,
        lessonId,
        completed: true,
        completedAt,
      },
      update: {
        completed: true,
        ...(existing?.completedAt ? {} : { completedAt }),
      },
    });

    // Recompute course progress
    const { progressPercentage, completedLessons, totalLessons } =
      await computeCourseProgress(app.prisma, userId, course.id);

    // Update enrollment
    const status = progressPercentage >= 100 ? "completed" : "in-progress";
    await app.prisma.courseEnrollment.updateMany({
      where: { userId, courseId: course.id },
      data: {
        progressPercentage,
        status,
        lastAccessedAt: new Date(),
        currentLessonId: lessonId,
      },
    });

    return reply.send({
      progress: {
        isCompleted: true,
        completedAt,
      },
      courseProgress: {
        progressPercentage,
        completedLessons,
        totalLessons,
        status,
      },
    });
  });
}
