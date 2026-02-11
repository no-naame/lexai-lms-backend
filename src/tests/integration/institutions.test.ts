import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  loginAs,
  injectWithAuth,
  createOrganization,
  createOrgMember,
  createStudentRecord,
  createBatch,
  seedCourseWithModulesAndLessons,
  prisma,
} from "../helpers.js";

describe("INTEGRATION — INSTITUTION FLOWS", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── STUDENT MANAGEMENT ──────────────────────────────────────

  describe("STUDENT MANAGEMENT", () => {
    it("org admin can list students in their org", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "orgadmin@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      await createStudentRecord({
        organizationId: org.id,
        email: "student@testuni.edu",
        enrollmentId: "STU001",
      });

      const { cookies } = await loginAs(app, "orgadmin@testuni.edu");
      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${org.id}/students`);

      expect(res.statusCode).toBe(200);
      expect(res.json().students).toHaveLength(1);
      expect(res.json().students[0].email).toBe("student@testuni.edu");
    });

    it("org admin can delete student record", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "orgadmin2@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const record = await createStudentRecord({
        organizationId: org.id,
        email: "todelete@testuni.edu",
        enrollmentId: "STU002",
      });

      const { cookies } = await loginAs(app, "orgadmin2@testuni.edu");
      const res = await injectWithAuth(app, cookies, "DELETE", `/institutions/${org.id}/students/${record.id}`);

      expect(res.statusCode).toBe(200);

      // Verify deletion
      const remaining = await prisma.studentRecord.findMany({
        where: { organizationId: org.id },
      });
      expect(remaining).toHaveLength(0);
    });

    it("deleting claimed student removes org membership", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "orgadmin3@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const student = await createUser({ email: "claimed@testuni.edu" });
      await createOrgMember({ userId: student.id, organizationId: org.id, role: "STUDENT", isVerified: true });

      const record = await createStudentRecord({
        organizationId: org.id,
        email: "claimed@testuni.edu",
        enrollmentId: "STU003",
        isClaimed: true,
        claimedByUserId: student.id,
      });

      const { cookies } = await loginAs(app, "orgadmin3@testuni.edu");
      await injectWithAuth(app, cookies, "DELETE", `/institutions/${org.id}/students/${record.id}`);

      // Verify membership removed
      const membership = await prisma.organizationMember.findUnique({
        where: {
          userId_organizationId: { userId: student.id, organizationId: org.id },
        },
      });
      expect(membership).toBeNull();
    });
  });

  // ─── CSV UPLOAD ──────────────────────────────────────────────

  describe("CSV UPLOAD", () => {
    it("valid CSV upload creates student records", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "csvadmin@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const { cookies } = await loginAs(app, "csvadmin@testuni.edu");

      const csvContent = "name,email,enrollmentId\nAlice,alice@testuni.edu,A001\nBob,bob@testuni.edu,B001";
      const boundary = "----boundary";
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="students.csv"\r\nContent-Type: text/csv\r\n\r\n${csvContent}\r\n--${boundary}--`;

      const res = await app.inject({
        method: "POST",
        url: `/institutions/${org.id}/students/upload`,
        headers: {
          cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().stats.added).toBe(2);

      // Verify records created
      const records = await prisma.studentRecord.findMany({
        where: { organizationId: org.id },
      });
      expect(records).toHaveLength(2);
    });

    it("CSV with existing email → auto-links (documents current behavior)", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "csvadmin2@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      // Create an existing user
      const existingUser = await createUser({ email: "existing@testuni.edu" });

      const { cookies } = await loginAs(app, "csvadmin2@testuni.edu");

      const csvContent = "name,email,enrollmentId\nExisting User,existing@testuni.edu,E001";
      const boundary = "----boundary";
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="students.csv"\r\nContent-Type: text/csv\r\n\r\n${csvContent}\r\n--${boundary}--`;

      const res = await app.inject({
        method: "POST",
        url: `/institutions/${org.id}/students/upload`,
        headers: {
          cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().stats.autoLinked).toBe(1);

      // Verify membership created
      const membership = await prisma.organizationMember.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId: org.id },
        },
      });
      expect(membership).toBeTruthy();
      expect(membership!.isVerified).toBe(true);
    });
  });

  // ─── COURSE ACCESS MANAGEMENT ────────────────────────────────

  describe("COURSE ACCESS MANAGEMENT", () => {
    it("org admin can assign course access to org", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "courseadmin@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const courseData = await seedCourseWithModulesAndLessons();
      const { cookies } = await loginAs(app, "courseadmin@testuni.edu");

      const res = await injectWithAuth(app, cookies, "POST", `/institutions/${org.id}/courses`, {
        courseId: courseData.course.id,
      });

      expect(res.statusCode).toBe(201);

      // Verify access created
      const access = await prisma.organizationCourseAccess.findUnique({
        where: {
          organizationId_courseId: {
            organizationId: org.id,
            courseId: courseData.course.id,
          },
        },
      });
      expect(access).toBeTruthy();
    });

    it("org admin can assign course access to batch", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "batchadmin@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const batch = await createBatch(org.id, "Batch A");
      const courseData = await seedCourseWithModulesAndLessons();
      const { cookies } = await loginAs(app, "batchadmin@testuni.edu");

      const res = await injectWithAuth(app, cookies, "POST", `/institutions/${org.id}/courses`, {
        courseId: courseData.course.id,
        batchId: batch.id,
      });

      expect(res.statusCode).toBe(201);

      const access = await prisma.batchCourseAccess.findUnique({
        where: {
          batchId_courseId: { batchId: batch.id, courseId: courseData.course.id },
        },
      });
      expect(access).toBeTruthy();
    });

    it("org admin can remove course access", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "removeadmin@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const courseData = await seedCourseWithModulesAndLessons();
      const { cookies } = await loginAs(app, "removeadmin@testuni.edu");

      // Assign first
      await injectWithAuth(app, cookies, "POST", `/institutions/${org.id}/courses`, {
        courseId: courseData.course.id,
      });

      // Remove
      const res = await injectWithAuth(
        app,
        cookies,
        "DELETE",
        `/institutions/${org.id}/courses/${courseData.course.id}`
      );
      expect(res.statusCode).toBe(200);

      const access = await prisma.organizationCourseAccess.findUnique({
        where: {
          organizationId_courseId: {
            organizationId: org.id,
            courseId: courseData.course.id,
          },
        },
      });
      expect(access).toBeNull();
    });

    it("removing access does not unenroll students (documents behavior)", async () => {
      const org = await createOrganization({});
      const admin = await createUser({ email: "nounroll@testuni.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: admin.id, organizationId: org.id, role: "ADMIN", isVerified: true });

      const student = await createUser({ email: "keepenrolled@testuni.edu" });
      await createOrgMember({ userId: student.id, organizationId: org.id, role: "STUDENT", isVerified: true });

      const courseData = await seedCourseWithModulesAndLessons();
      const { cookies } = await loginAs(app, "nounroll@testuni.edu");

      // Assign course (auto-enrolls student)
      await injectWithAuth(app, cookies, "POST", `/institutions/${org.id}/courses`, {
        courseId: courseData.course.id,
      });

      // Verify student is enrolled
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId: student.id, courseId: courseData.course.id },
        },
      });
      expect(enrollment).toBeTruthy();

      // Remove course access
      await injectWithAuth(
        app,
        cookies,
        "DELETE",
        `/institutions/${org.id}/courses/${courseData.course.id}`
      );

      // Student should STILL be enrolled (removing access doesn't unenroll)
      const stillEnrolled = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId: student.id, courseId: courseData.course.id },
        },
      });
      expect(stillEnrolled).toBeTruthy();
    });
  });

  // ─── INSTITUTION VERIFICATION ────────────────────────────────

  describe("INSTITUTION VERIFICATION", () => {
    it("valid enrollmentId + matching email → verified + enrolled in all courses", async () => {
      const org = await createOrganization({ emailDomains: ["testuni.edu"] });
      await seedCourseWithModulesAndLessons(); // Creates a published course

      const user = await createUser({ email: "newstudent@testuni.edu" });
      await createStudentRecord({
        organizationId: org.id,
        email: "newstudent@testuni.edu",
        enrollmentId: "NEW001",
      });

      const { cookies } = await loginAs(app, "newstudent@testuni.edu");
      const res = await injectWithAuth(app, cookies, "POST", "/auth/verify-institution", {
        enrollmentId: "NEW001",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify membership created and verified
      const membership = await prisma.organizationMember.findUnique({
        where: {
          userId_organizationId: { userId: user.id, organizationId: org.id },
        },
      });
      expect(membership!.isVerified).toBe(true);

      // Verify auto-enrolled in courses
      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments.length).toBeGreaterThan(0);
    });

    it("wrong enrollmentId → 400", async () => {
      const org = await createOrganization({ emailDomains: ["testuni.edu"] });
      await createUser({ email: "wrongid@testuni.edu" });
      await createStudentRecord({
        organizationId: org.id,
        email: "wrongid@testuni.edu",
        enrollmentId: "CORRECT",
      });

      const { cookies } = await loginAs(app, "wrongid@testuni.edu");
      const res = await injectWithAuth(app, cookies, "POST", "/auth/verify-institution", {
        enrollmentId: "WRONG",
      });

      expect(res.statusCode).toBe(400);
    });

    it("already-claimed enrollmentId → 400", async () => {
      const org = await createOrganization({ emailDomains: ["testuni.edu"] });
      const claimer = await createUser({ email: "claimer@testuni.edu" });
      await createStudentRecord({
        organizationId: org.id,
        email: "claimer@testuni.edu",
        enrollmentId: "CLAIMED",
        isClaimed: true,
        claimedByUserId: claimer.id,
      });
      await createOrgMember({
        userId: claimer.id,
        organizationId: org.id,
        isVerified: true,
      });

      // Second user tries same enrollment ID (different record needed)
      const user2 = await createUser({ email: "second@testuni.edu" });
      // No unclaimed record exists for this email/enrollmentId
      const { cookies } = await loginAs(app, "second@testuni.edu");
      const res = await injectWithAuth(app, cookies, "POST", "/auth/verify-institution", {
        enrollmentId: "CLAIMED",
      });

      // Should fail — no matching unclaimed record
      expect(res.statusCode).toBe(400);
    });

    it("non-institutional email domain → no org found", async () => {
      await createOrganization({ emailDomains: ["testuni.edu"] });
      await createUser({ email: "user@gmail.com" });

      const { cookies } = await loginAs(app, "user@gmail.com");
      const res = await injectWithAuth(app, cookies, "POST", "/auth/verify-institution", {
        enrollmentId: "ANY",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/no institution/i);
    });
  });
});
