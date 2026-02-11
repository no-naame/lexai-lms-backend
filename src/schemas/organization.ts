import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  emailDomains: z
    .array(z.string().min(1))
    .min(1, "At least one email domain is required"),
  contractStart: z.string().datetime().optional(),
  contractEnd: z.string().datetime().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const addOrgAdminSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export const assignCourseSchema = z.object({
  courseId: z.string().min(1),
  batchId: z.string().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type AddOrgAdminInput = z.infer<typeof addOrgAdminSchema>;
export type AssignCourseInput = z.infer<typeof assignCourseSchema>;
