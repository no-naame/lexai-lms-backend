import { z } from "zod";

export const studentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  batchId: z.string().optional(),
  claimed: z.enum(["true", "false"]).optional(),
});

export type StudentQuery = z.infer<typeof studentQuerySchema>;
