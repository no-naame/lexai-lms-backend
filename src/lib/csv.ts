import Papa from "papaparse";
import { z } from "zod";

const csvRowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  enrollmentId: z.string().min(1, "Enrollment ID is required"),
  batch: z.string().optional().default(""),
});

export type CSVStudentRow = z.infer<typeof csvRowSchema>;

export interface CSVParseResult {
  valid: CSVStudentRow[];
  errors: { row: number; message: string }[];
}

export function parseStudentCSV(csvContent: string): CSVParseResult {
  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, ""),
  });

  const valid: CSVStudentRow[] = [];
  const errors: { row: number; message: string }[] = [];

  // Map common header variations
  const rows = (result.data as Record<string, string>[]).map((row) => ({
    name: row.name || row.studentname || row.fullname || row.student_name || "",
    email: row.email || row.emailaddress || row.email_address || row.studentemail || "",
    enrollmentId:
      row.enrollmentid ||
      row.enrollment_id ||
      row.studentid ||
      row.student_id ||
      row.rollnumber ||
      row.roll_number ||
      "",
    batch: row.batch || row.batchname || row.batch_name || row.section || "",
  }));

  for (let i = 0; i < rows.length; i++) {
    const parsed = csvRowSchema.safeParse(rows[i]);
    if (parsed.success) {
      valid.push({
        ...parsed.data,
        email: parsed.data.email.toLowerCase(),
      });
    } else {
      const messages = parsed.error.errors.map((e) => e.message).join(", ");
      errors.push({ row: i + 2, message: messages }); // +2 for header + 0-index
    }
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      errors.push({ row: err.row ? err.row + 1 : 0, message: err.message });
    }
  }

  return { valid, errors };
}
