import type { PrismaClient } from "@prisma/client";

/**
 * Check if a user can access a specific course.
 * Subscription model: access to ALL courses is granted if any of these are true:
 * 1. User has a direct CourseEnrollment (individual purchase/subscription or institutional)
 * 2. User is a verified member of ANY active organization (institutional subscription)
 */
export async function canAccessCourse(
  prisma: PrismaClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  // Run both checks in parallel — either one grants access
  const [directEnrollment, membership] = await Promise.all([
    prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    }),
    prisma.organizationMember.findFirst({
      where: {
        userId,
        isActive: true,
        isVerified: true,
        organization: { isActive: true },
      },
    }),
  ]);

  return !!(directEnrollment || membership);
}

/**
 * Check if a user can access a specific lesson.
 * Free lessons are accessible to everyone. Paid lessons require subscription/enrollment.
 *
 * Accepts an optional pre-fetched lesson to avoid a duplicate DB round trip
 * when the caller has already loaded the lesson with module.course included.
 */
export async function canAccessLesson(
  prisma: PrismaClient,
  userId: string | undefined,
  lessonId: string,
  prefetchedLesson?: { isFree: boolean; module: { course: { id: string; isPublished: boolean } } }
): Promise<{ accessible: boolean; reason?: string }> {
  const lesson = prefetchedLesson ?? await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: {
        include: {
          course: { select: { id: true, title: true, slug: true, isPublished: true } },
        },
      },
    },
  });

  if (!lesson || !lesson.module.course.isPublished) {
    return { accessible: false, reason: "not_found" };
  }

  // Free lessons are accessible to everyone
  if (lesson.isFree) {
    return { accessible: true };
  }

  // Paid lesson requires authentication
  if (!userId) {
    return { accessible: false, reason: "unauthenticated" };
  }

  // Check subscription/enrollment
  const hasAccess = await canAccessCourse(prisma, userId, lesson.module.course.id);
  if (!hasAccess) {
    return { accessible: false, reason: "no_subscription" };
  }

  return { accessible: true };
}

/**
 * Auto-enroll a verified member in ALL published courses.
 * Subscription model: institutional access = all courses.
 */
export async function autoEnrollMember(
  prisma: PrismaClient,
  userId: string,
  _organizationId: string,
  _batchId: string | null
) {
  // Get ALL published courses
  const allCourses = await prisma.course.findMany({
    where: { isPublished: true },
    select: { id: true },
  });

  // Create enrollments for each course (skip if already enrolled)
  for (const course of allCourses) {
    await prisma.courseEnrollment.upsert({
      where: {
        userId_courseId: { userId, courseId: course.id },
      },
      create: {
        userId,
        courseId: course.id,
        accessSource: "INSTITUTION",
      },
      update: {},
    });
  }
}

/**
 * Enroll a B2C user in ALL published courses (after subscription payment).
 */
export async function enrollSubscriber(
  prisma: PrismaClient,
  userId: string
) {
  const allCourses = await prisma.course.findMany({
    where: { isPublished: true },
    select: { id: true },
  });

  for (const course of allCourses) {
    await prisma.courseEnrollment.upsert({
      where: {
        userId_courseId: { userId, courseId: course.id },
      },
      create: {
        userId,
        courseId: course.id,
        accessSource: "INDIVIDUAL",
      },
      update: {},
    });
  }
}
