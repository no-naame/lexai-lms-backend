import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../hooks/auth.js";
import { canAccessCourse } from "../../lib/access.js";
import type { JWTPayload } from "../../types/index.js";

export default async function coursesRoutes(app: FastifyInstance) {
  // GET /courses/featured - List featured published courses (public)
  // Registered BEFORE /:slug to avoid route conflict
  app.get("/featured", {
    schema: {
      tags: ["Courses"],
      summary: "List featured courses",
      description: "Get up to 3 featured published courses.",
      response: {
        200: {
          description: "Featured courses",
          type: "object",
          additionalProperties: true,
        },
      },
    },
  }, async (request, reply) => {
    const courses = await app.prisma.course.findMany({
      where: { isPublished: true, isFeatured: true },
      take: 3,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        shortDescription: true,
        thumbnail: true,
        price: true,
        category: true,
        level: true,
        tags: true,
        studentsCount: true,
        rating: true,
        reviewsCount: true,
        isFeatured: true,
        _count: {
          select: { modules: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Single SQL aggregation for lesson counts and total duration — avoids loading every lesson row
    const courseIds = courses.map((c) => c.id);
    const stats = courseIds.length > 0
      ? await app.prisma.$queryRaw<{ courseId: string; lessonCount: bigint; totalDuration: bigint }[]>`
          SELECT m."courseId" AS "courseId",
                 COUNT(l.id)::bigint AS "lessonCount",
                 COALESCE(SUM(l.duration), 0)::bigint AS "totalDuration"
          FROM modules m
          JOIN lessons l ON l."moduleId" = m.id
          WHERE m."courseId" IN (${Prisma.join(courseIds)})
          GROUP BY m."courseId"
        `
      : [];
    const statsMap = new Map(stats.map((s) => [s.courseId, s]));

    const result = courses.map((c) => {
      const s = statsMap.get(c.id);
      return {
        id: c.slug,
        title: c.title,
        slug: c.slug,
        description: c.shortDescription ?? c.description,
        shortDescription: c.shortDescription,
        thumbnail: c.thumbnail,
        price: c.price,
        category: c.category,
        level: c.level,
        tags: c.tags,
        studentsCount: c.studentsCount,
        rating: c.rating,
        reviewsCount: c.reviewsCount,
        totalModules: c._count.modules,
        totalLessons: Number(s?.lessonCount ?? 0),
        totalDurationMinutes: Math.round(Number(s?.totalDuration ?? 0) / 60),
        isFeatured: c.isFeatured,
      };
    });

    return reply.send({ courses: result });
  });

  // GET /courses - List published courses (public)
  app.get("/", {
    schema: {
      tags: ["Courses"],
      summary: "List published courses",
      description: "Get the public course catalog with filtering and pagination.",
      querystring: {
        type: "object",
        properties: {
          category: { type: "string" },
          level: { type: "string" },
          featured: { type: "string" },
          limit: { type: "integer", default: 20 },
          offset: { type: "integer", default: 0 },
          search: { type: "string" },
        },
      },
      response: {
        200: {
          description: "Course catalog",
          type: "object",
          additionalProperties: true,
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as {
      category?: string;
      level?: string;
      featured?: string;
      limit?: number;
      offset?: number;
      search?: string;
    };

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    // Build dynamic where clause
    const where: any = { isPublished: true };

    if (query.category) {
      where.category = query.category;
    }
    if (query.level) {
      where.level = query.level;
    }
    if (query.featured === "true") {
      where.isFeatured = true;
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { shortDescription: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [courses, total] = await Promise.all([
      app.prisma.course.findMany({
        where,
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          shortDescription: true,
          thumbnail: true,
          price: true,
          category: true,
          level: true,
          tags: true,
          studentsCount: true,
          rating: true,
          reviewsCount: true,
          isFeatured: true,
          _count: {
            select: { modules: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      app.prisma.course.count({ where }),
    ]);

    // Single SQL aggregation for lesson counts and total duration
    const courseIds = courses.map((c) => c.id);
    const stats = courseIds.length > 0
      ? await app.prisma.$queryRaw<{ courseId: string; lessonCount: bigint; totalDuration: bigint }[]>`
          SELECT m."courseId" AS "courseId",
                 COUNT(l.id)::bigint AS "lessonCount",
                 COALESCE(SUM(l.duration), 0)::bigint AS "totalDuration"
          FROM modules m
          JOIN lessons l ON l."moduleId" = m.id
          WHERE m."courseId" IN (${Prisma.join(courseIds)})
          GROUP BY m."courseId"
        `
      : [];
    const statsMap = new Map(stats.map((s) => [s.courseId, s]));

    const result = courses.map((c) => {
      const s = statsMap.get(c.id);
      return {
        id: c.slug,
        title: c.title,
        slug: c.slug,
        description: c.shortDescription ?? c.description,
        shortDescription: c.shortDescription,
        thumbnail: c.thumbnail,
        price: c.price,
        category: c.category,
        level: c.level,
        tags: c.tags,
        studentsCount: c.studentsCount,
        rating: c.rating,
        reviewsCount: c.reviewsCount,
        totalModules: c._count.modules,
        totalLessons: Number(s?.lessonCount ?? 0),
        totalDurationMinutes: Math.round(Number(s?.totalDuration ?? 0) / 60),
        isFeatured: c.isFeatured,
      };
    });

    return reply.send({
      courses: result,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  });

  // GET /courses/:slug - Get course details with full structure (public)
  app.get("/:slug", {
    schema: {
      tags: ["Courses"],
      summary: "Get course details",
      description: "Get detailed course information with full module/lesson structure.",
      params: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string", description: "Course URL slug", example: "intro-to-ai" },
        },
      },
      response: {
        200: {
          description: "Course details with modules and lesson metadata",
          type: "object",
          additionalProperties: true,
        },
        404: {
          description: "Course not found or not published",
          type: "object",
          properties: { error: { type: "string", example: "Course not found" } },
        },
      },
    },
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const course = await app.prisma.course.findUnique({
      where: { slug },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        shortDescription: true,
        longDescription: true,
        thumbnail: true,
        introVideoUrl: true,
        price: true,
        isPublished: true,
        category: true,
        level: true,
        tags: true,
        studentsCount: true,
        rating: true,
        reviewsCount: true,
        includes: true,
        whatYouWillLearn: true,
        prerequisites: true,
        isFeatured: true,
        publishedAt: true,
        modules: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            description: true,
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
                order: true,
              },
            },
          },
        },
      },
    });

    if (!course || !course.isPublished) {
      return reply.status(404).send({ error: "Course not found" });
    }

    // Check access if user is authenticated
    let hasAccess = false;
    try {
      const payload = await request.jwtVerify<JWTPayload>();
      request.currentUser = payload;
      hasAccess = await canAccessCourse(app.prisma, payload.userId, course.id);
    } catch {
      // Not authenticated - that's fine for public listing
    }

    const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const totalDurationSeconds = course.modules.reduce(
      (sum, m) => sum + m.lessons.reduce((s, l) => s + l.duration, 0),
      0
    );

    const modules = course.modules.map((m) => {
      const moduleDurationSeconds = m.lessons.reduce((s, l) => s + l.duration, 0);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        order: m.order,
        totalLessons: m.lessons.length,
        lessonCount: m.lessons.length,
        videoCount: m.lessons.filter((l) => l.type === "VIDEO").length,
        totalDurationMinutes: Math.round(moduleDurationSeconds / 60),
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type.toLowerCase(),
          isFree: l.isFree,
          isPreview: l.isPreview,
          duration: l.duration,
          videoDurationMinutes: Math.round(l.duration / 60),
          order: l.order,
        })),
      };
    });

    return reply.send({
      course: {
        id: course.slug,
        title: course.title,
        slug: course.slug,
        description: course.longDescription ?? course.description,
        shortDescription: course.shortDescription,
        longDescription: course.longDescription,
        thumbnail: course.thumbnail,
        introVideoUrl: course.introVideoUrl,
        price: course.price,
        category: course.category,
        level: course.level,
        tags: course.tags,
        studentsCount: course.studentsCount,
        rating: course.rating,
        reviewsCount: course.reviewsCount,
        includes: course.includes,
        whatYouWillLearn: course.whatYouWillLearn,
        prerequisites: course.prerequisites,
        isFeatured: course.isFeatured,
        publishedAt: course.publishedAt,
        totalModules: course.modules.length,
        totalLessons,
        totalDurationMinutes: Math.round(totalDurationSeconds / 60),
      },
      modules,
      hasAccess,
    });
  });

  // GET /courses/my/enrolled - List courses the user has access to
  app.get(
    "/my/enrolled",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Courses"],
        summary: "List enrolled courses",
        description: "List all courses the authenticated user has access to, with access source (INDIVIDUAL or INSTITUTION).",
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            description: "Enrolled courses",
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
    },
    async (request, reply) => {
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
            },
          },
        },
      });

      return reply.send({
        courses: enrollments.map((e) => ({
          ...e.course,
          accessSource: e.accessSource,
        })),
      });
    }
  );
}
