import { z } from "zod";

// ─── Admin Course CRUD ───────────────────────────────────────

export const createCourseSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(5000).optional(),
  shortDescription: z.string().max(150).optional(),
  longDescription: z.string().optional(),
  thumbnail: z.string().url().optional(),
  introVideoUrl: z.string().url().optional(),
  price: z.number().min(0).optional(),
  isPublished: z.boolean().optional(),
  category: z.string().optional(),
  level: z.string().optional(),
  tags: z.array(z.string()).optional(),
  studentsCount: z.number().int().min(0).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewsCount: z.number().int().min(0).optional(),
  includes: z.any().optional(),
  whatYouWillLearn: z.any().optional(),
  prerequisites: z.any().optional(),
  isFeatured: z.boolean().optional(),
  publishedAt: z.string().datetime().optional().or(z.date().optional()),
});

export const updateCourseSchema = createCourseSchema.partial();

// ─── Admin Module CRUD ───────────────────────────────────────

export const createModuleSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  order: z.number().int().min(1),
});

export const updateModuleSchema = createModuleSchema.partial();

// ─── Admin Lesson CRUD ───────────────────────────────────────

export const createLessonSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  order: z.number().int().min(1),
  type: z.enum(["VIDEO", "ARTICLE"]).default("ARTICLE"),
  isFree: z.boolean().optional(),
  isPreview: z.boolean().optional(),
  videoUrl: z.string().url().optional(),
  content: z.string().optional(),
  duration: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  resources: z.any().optional(),
});

export const updateLessonSchema = createLessonSchema.partial();

// ─── Reorder ─────────────────────────────────────────────────

export const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        order: z.number().int().min(1),
      })
    )
    .min(1),
});

// ─── Progress ────────────────────────────────────────────────

export const updateProgressSchema = z.object({
  completed: z.boolean().optional(),
  watchedSeconds: z.number().int().min(0).optional(),
});

// ─── Types ───────────────────────────────────────────────────

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateModuleInput = z.infer<typeof createModuleSchema>;
export type UpdateModuleInput = z.infer<typeof updateModuleSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
