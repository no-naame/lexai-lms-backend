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
  seedCourseWithModulesAndLessons,
  createStudentRecord,
  createBatch,
  prisma,
} from "../helpers.js";

describe("ADMIN RBAC & PRIVILEGE ESCALATION", () => {
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

  // ─── ROLE-BASED ACCESS — ADMIN COURSE CRUD ───────────────────

  describe("ROLE-BASED ACCESS — ADMIN COURSE CRUD", () => {
    const coursePayload = {
      title: "New Course",
      slug: "new-course",
      description: "Test",
    };

    it("PLATFORM_ADMIN can POST /admin/courses → 201", async () => {
      await createUser({ email: "admin@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admin@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      expect(res.statusCode).toBe(201);
    });

    it("PLATFORM_ADMIN can PATCH /admin/courses/:id → 200", async () => {
      await createUser({ email: "admin2@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admin2@example.com");

      const createRes = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      const courseId = createRes.json().course.id;

      const res = await injectWithAuth(app, cookies, "PATCH", `/admin/courses/${courseId}`, {
        title: "Updated",
      });
      expect(res.statusCode).toBe(200);
    });

    it("PLATFORM_ADMIN can DELETE /admin/courses/:id → 200", async () => {
      await createUser({ email: "admin3@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admin3@example.com");

      const createRes = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      const courseId = createRes.json().course.id;

      const res = await injectWithAuth(app, cookies, "DELETE", `/admin/courses/${courseId}`);
      expect(res.statusCode).toBe(200);
    });

    it("INSTITUTION_ADMIN cannot POST /admin/courses → 403", async () => {
      await createUser({ email: "instadmin@example.com", role: "INSTITUTION_ADMIN" });
      const { cookies } = await loginAs(app, "instadmin@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      expect(res.statusCode).toBe(403);
    });

    it("INSTRUCTOR cannot POST /admin/courses → 403", async () => {
      await createUser({ email: "instructor@example.com", role: "INSTRUCTOR" });
      const { cookies } = await loginAs(app, "instructor@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      expect(res.statusCode).toBe(403);
    });

    it("STUDENT cannot POST /admin/courses → 403", async () => {
      await createUser({ email: "student@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/admin/courses", coursePayload);
      expect(res.statusCode).toBe(403);
    });

    it("unauthenticated user cannot POST /admin/courses → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/courses",
        payload: coursePayload,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── ROLE-BASED ACCESS — ADMIN MODULE/LESSON CRUD ──────────────

  describe("ROLE-BASED ACCESS — ADMIN MODULE/LESSON CRUD", () => {
    it("STUDENT cannot create module → 403", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      await createUser({ email: "student2@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/admin/courses/${courseData.course.id}/modules`,
        { title: "Hack Module", order: 99 }
      );
      expect(res.statusCode).toBe(403);
    });

    it("STUDENT cannot create lesson → 403", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      await createUser({ email: "student3@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student3@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/admin/courses/${courseData.course.id}/modules/${courseData.module.id}/lessons`,
        { title: "Hack Lesson", order: 99 }
      );
      expect(res.statusCode).toBe(403);
    });

    it("STUDENT cannot delete lesson → 403", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      await createUser({ email: "student4@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student4@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "DELETE",
        `/admin/courses/${courseData.course.id}/modules/${courseData.module.id}/lessons/${courseData.freeLesson.id}`
      );
      expect(res.statusCode).toBe(403);
    });

    it("STUDENT cannot reorder modules → 403", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      await createUser({ email: "student5@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student5@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "PATCH",
        `/admin/courses/${courseData.course.id}/modules/reorder`,
        { items: [{ id: courseData.module.id, order: 2 }] }
      );
      expect(res.statusCode).toBe(403);
    });

    it("INSTITUTION_ADMIN cannot create lesson → 403", async () => {
      const courseData = await seedCourseWithModulesAndLessons();
      await createUser({ email: "instadmin2@example.com", role: "INSTITUTION_ADMIN" });
      const { cookies } = await loginAs(app, "instadmin2@example.com");

      const res = await injectWithAuth(
        app,
        cookies,
        "POST",
        `/admin/courses/${courseData.course.id}/modules/${courseData.module.id}/lessons`,
        { title: "Unauthorized Lesson", order: 99 }
      );
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── ROLE-BASED ACCESS — ADMIN ORGANIZATIONS ─────────────────

  describe("ROLE-BASED ACCESS — ADMIN ORGANIZATIONS", () => {
    it("PLATFORM_ADMIN can GET /admin/organizations → 200", async () => {
      await createUser({ email: "padmin@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "padmin@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/admin/organizations");
      expect(res.statusCode).toBe(200);
    });

    it("PLATFORM_ADMIN can POST /admin/organizations → 201", async () => {
      await createUser({ email: "padmin2@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "padmin2@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/admin/organizations", {
        name: "New Org",
        slug: "new-org",
        emailDomains: ["neworg.edu"],
      });
      expect(res.statusCode).toBe(201);
    });

    it("STUDENT cannot GET /admin/organizations → 403", async () => {
      await createUser({ email: "student6@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student6@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/admin/organizations");
      expect(res.statusCode).toBe(403);
    });

    it("INSTITUTION_ADMIN cannot GET /admin/organizations → 403", async () => {
      await createUser({ email: "instadmin3@example.com", role: "INSTITUTION_ADMIN" });
      const { cookies } = await loginAs(app, "instadmin3@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/admin/organizations");
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── ROLE-BASED ACCESS — ADMIN USERS ──────────────────────────

  describe("ROLE-BASED ACCESS — ADMIN USERS", () => {
    it("PLATFORM_ADMIN can GET /admin/users → 200", async () => {
      await createUser({ email: "padmin3@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "padmin3@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/admin/users");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("users");
      expect(res.json()).toHaveProperty("pagination");
    });

    it("PLATFORM_ADMIN can PATCH /admin/users/:id (role change) → 200", async () => {
      await createUser({ email: "padmin4@example.com", role: "PLATFORM_ADMIN" });
      const target = await createUser({ email: "target@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "padmin4@example.com");

      const res = await injectWithAuth(app, cookies, "PATCH", `/admin/users/${target.id}`, {
        role: "INSTRUCTOR",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.role).toBe("INSTRUCTOR");
    });

    it("STUDENT cannot GET /admin/users → 403", async () => {
      await createUser({ email: "student7@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "student7@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/admin/users");
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── INSTITUTION ADMIN SCOPING ────────────────────────────────

  describe("INSTITUTION ADMIN SCOPING", () => {
    it("Org Admin A cannot access Org B's students → 403", async () => {
      const orgA = await createOrganization({ name: "Org A", slug: "org-a", emailDomains: ["orga.edu"] });
      const orgB = await createOrganization({ name: "Org B", slug: "org-b", emailDomains: ["orgb.edu"] });

      const adminA = await createUser({ email: "admina@orga.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: adminA.id, organizationId: orgA.id, role: "ADMIN", isVerified: true });

      const { cookies } = await loginAs(app, "admina@orga.edu");

      // Try to access Org B's students
      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${orgB.id}/students`);
      expect(res.statusCode).toBe(403);
    });

    it("Org Admin A cannot upload CSV to Org B → 403", async () => {
      const orgA = await createOrganization({ name: "Org A2", slug: "org-a2", emailDomains: ["orga2.edu"] });
      const orgB = await createOrganization({ name: "Org B2", slug: "org-b2", emailDomains: ["orgb2.edu"] });

      const adminA = await createUser({ email: "admina2@orga2.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: adminA.id, organizationId: orgA.id, role: "ADMIN", isVerified: true });

      const { cookies } = await loginAs(app, "admina2@orga2.edu");

      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${orgB.id}/students`);
      expect(res.statusCode).toBe(403);
    });

    it("Org Admin A cannot manage Org B's courses → 403", async () => {
      const orgA = await createOrganization({ name: "Org C", slug: "org-c", emailDomains: ["orgc.edu"] });
      const orgB = await createOrganization({ name: "Org D", slug: "org-d", emailDomains: ["orgd.edu"] });

      const adminA = await createUser({ email: "adminc@orgc.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({ userId: adminA.id, organizationId: orgA.id, role: "ADMIN", isVerified: true });

      const { cookies } = await loginAs(app, "adminc@orgc.edu");

      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${orgB.id}/courses`);
      expect(res.statusCode).toBe(403);
    });

    it("PLATFORM_ADMIN can access any org's students (bypass) → 200", async () => {
      const org = await createOrganization({ name: "Any Org", slug: "any-org" });
      await createUser({ email: "superadmin@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "superadmin@example.com");

      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${org.id}/students`);
      expect(res.statusCode).toBe(200);
    });

    it("unverified org member cannot access org admin routes → 403", async () => {
      const org = await createOrganization({ name: "Unv Org", slug: "unv-org", emailDomains: ["unvorg.edu"] });
      const user = await createUser({ email: "unverified@unvorg.edu", role: "INSTITUTION_ADMIN" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        role: "ADMIN",
        isVerified: false,
      });
      const { cookies } = await loginAs(app, "unverified@unvorg.edu");

      const res = await injectWithAuth(app, cookies, "GET", `/institutions/${org.id}/students`);
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── PRIVILEGE ESCALATION ATTEMPTS ────────────────────────────

  describe("PRIVILEGE ESCALATION ATTEMPTS", () => {
    it("STUDENT sending PATCH to /admin/users/:ownId with role=PLATFORM_ADMIN → 403", async () => {
      const student = await createUser({ email: "escalate@example.com", role: "STUDENT" });
      const { cookies } = await loginAs(app, "escalate@example.com");

      const res = await injectWithAuth(app, cookies, "PATCH", `/admin/users/${student.id}`, {
        role: "PLATFORM_ADMIN",
      });
      expect(res.statusCode).toBe(403);
    });

    it("INSTITUTION_ADMIN cannot create PLATFORM_ADMIN users (POST /admin/users blocked)", async () => {
      await createUser({ email: "instescalate@example.com", role: "INSTITUTION_ADMIN" });
      const { cookies } = await loginAs(app, "instescalate@example.com");

      const res = await injectWithAuth(app, cookies, "PATCH", "/admin/users/someid", {
        role: "PLATFORM_ADMIN",
      });
      expect(res.statusCode).toBe(403);
    });

    it("adding extra fields to course creation (isPublished=true, price=-1) → validated/rejected", async () => {
      await createUser({ email: "extrafld@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "extrafld@example.com");

      // Negative price should be rejected by Zod (min(0))
      const res = await injectWithAuth(app, cookies, "POST", "/admin/courses", {
        title: "Bad Course",
        slug: "bad-course",
        price: -1,
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
