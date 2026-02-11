-- AlterTable
ALTER TABLE "course_enrollments" ADD COLUMN     "currentLessonId" TEXT,
ADD COLUMN     "lastAccessedAt" TIMESTAMP(3),
ADD COLUMN     "progressPercentage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'not-started';

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'engineering',
ADD COLUMN     "includes" JSONB,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" TEXT NOT NULL DEFAULT 'Beginner',
ADD COLUMN     "longDescription" TEXT,
ADD COLUMN     "prerequisites" JSONB,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reviewsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shortDescription" VARCHAR(150),
ADD COLUMN     "studentsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whatYouWillLearn" JSONB;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "isPreview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "resources" JSONB;
