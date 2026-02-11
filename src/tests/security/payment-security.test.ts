import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  cleanDatabase,
  createUser,
  createPayment,
  loginAs,
  injectWithAuth,
  seedCourseWithModulesAndLessons,
  createOrganization,
  createOrgMember,
  prisma,
} from "../helpers.js";

vi.mock("../../lib/razorpay.js", () => ({
  createOrder: vi.fn().mockResolvedValue({
    id: "order_test_123",
    amount: 49900,
    currency: "INR",
    receipt: "receipt_test",
  }),
  verifyPaymentSignature: vi.fn().mockReturnValue(true),
  verifyWebhookSignatureFn: vi.fn().mockReturnValue(true),
}));

import { verifyPaymentSignature, verifyWebhookSignatureFn } from "../../lib/razorpay.js";

describe("SECURITY — PAYMENT SYSTEM", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "test_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_test_secret";
    process.env.PLATFORM_PRICE = "49900";
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    vi.mocked(verifyPaymentSignature).mockReturnValue(true);
    vi.mocked(verifyWebhookSignatureFn).mockReturnValue(true);
  });

  // ─── ENROLLMENT GATE ───────────────────────────────────────

  describe("ENROLLMENT GATE", () => {
    it("unpaid non-org user cannot self-enroll", async () => {
      await seedCourseWithModulesAndLessons();
      await createUser({ email: "unpaid@example.com" });
      const { cookies } = await loginAs(app, "unpaid@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(403);
    });

    it("premium user can self-enroll", async () => {
      await seedCourseWithModulesAndLessons();
      await createUser({ email: "premium@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "premium@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(201);
    });

    it("verified org member can self-enroll", async () => {
      await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "orgstudent@example.com" });
      const org = await createOrganization({ name: "Gate Uni", slug: "gate-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "orgstudent@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(201);
    });

    it("PLATFORM_ADMIN bypasses payment gate", async () => {
      await seedCourseWithModulesAndLessons();
      await createUser({ email: "admin@example.com", role: "PLATFORM_ADMIN" });
      const { cookies } = await loginAs(app, "admin@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(201);
    });

    it("unverified org member cannot self-enroll", async () => {
      await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "unverorg@example.com" });
      const org = await createOrganization({ name: "Unver Uni", slug: "unver-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: false,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "unverorg@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(403);
    });

    it("inactive org member cannot self-enroll", async () => {
      await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "inactmem@example.com" });
      const org = await createOrganization({ name: "Inact Uni", slug: "inact-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: false,
      });
      const { cookies } = await loginAs(app, "inactmem@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/user/enrollments/test-course");
      expect(res.statusCode).toBe(403);
    });
  });

  // ─── WEBHOOK SECURITY ──────────────────────────────────────

  describe("WEBHOOK SECURITY", () => {
    function buildWebhookPayload(event: string, orderId: string, paymentId: string) {
      return {
        event,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              status: event === "payment.captured" ? "captured" : "failed",
            },
          },
        },
      };
    }

    it("payment.captured grants premium access", async () => {
      await seedCourseWithModulesAndLessons();
      const user = await createUser({ email: "webhookuser@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_wh_1" });

      const payload = buildWebhookPayload("payment.captured", "order_wh_1", "pay_wh_1");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_webhook_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.isPremium).toBe(true);

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments.length).toBeGreaterThanOrEqual(1);
    });

    it("payment.captured is idempotent", async () => {
      const user = await createUser({ email: "idempwh@example.com", isPremium: true });
      await createPayment({
        userId: user.id,
        razorpayOrderId: "order_wh_idem",
        razorpayPaymentId: "pay_wh_idem",
        status: "paid",
      });

      const payload = buildWebhookPayload("payment.captured", "order_wh_idem", "pay_wh_idem");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_webhook_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);

      // Payment status should still be "paid"
      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: "order_wh_idem" },
      });
      expect(payment!.status).toBe("paid");
    });

    it("payment.failed updates payment status", async () => {
      const user = await createUser({ email: "failwh@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_wh_fail" });

      const payload = buildWebhookPayload("payment.failed", "order_wh_fail", "pay_wh_fail");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_webhook_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);

      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: "order_wh_fail" },
      });
      expect(payment!.status).toBe("failed");
    });

    it("payment.failed does not downgrade paid user", async () => {
      const user = await createUser({ email: "nodown@example.com", isPremium: true });
      await createPayment({
        userId: user.id,
        razorpayOrderId: "order_wh_nodown",
        razorpayPaymentId: "pay_wh_nodown",
        status: "paid",
      });

      const payload = buildWebhookPayload("payment.failed", "order_wh_nodown", "pay_wh_nodown");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_webhook_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);

      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: "order_wh_nodown" },
      });
      expect(payment!.status).toBe("paid");
    });

    it("rejects request with invalid signature", async () => {
      vi.mocked(verifyWebhookSignatureFn).mockReturnValueOnce(false);

      const payload = buildWebhookPayload("payment.captured", "order_x", "pay_x");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "bad_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().received).toBe(false);
    });

    it("rejects request with missing signature header", async () => {
      const payload = buildWebhookPayload("payment.captured", "order_x", "pay_x");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          // no x-razorpay-signature header
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);
    });

    it("acknowledges unknown order_id silently", async () => {
      const payload = buildWebhookPayload("payment.captured", "order_unknown_xyz", "pay_unknown");
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
    });

    it("acknowledges unknown event types silently", async () => {
      const payload = {
        event: "refund.processed",
        payload: {
          payment: {
            entity: {
              id: "pay_refund",
              order_id: "order_refund",
              status: "refunded",
            },
          },
        },
      };
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
    });

    it("handles missing payload fields gracefully", async () => {
      const payload = { event: undefined, payload: undefined };
      const rawBody = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/webhooks/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "valid_sig",
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
    });
  });

  // ─── PAYMENT VERIFICATION SECURITY ─────────────────────────

  describe("PAYMENT VERIFICATION SECURITY", () => {
    it("user cannot verify another user's payment", async () => {
      const userA = await createUser({ email: "ownerA@example.com" });
      await createUser({ email: "attackerB@example.com" });
      await createPayment({ userId: userA.id, razorpayOrderId: "order_sec_1" });
      const { cookies: cookiesB } = await loginAs(app, "attackerB@example.com");

      const res = await injectWithAuth(app, cookiesB, "POST", "/payments/verify", {
        razorpay_order_id: "order_sec_1",
        razorpay_payment_id: "pay_sec_1",
        razorpay_signature: "valid_sig",
      });

      expect(res.statusCode).toBe(404);
    });

    it("signature verification prevents forged payments", async () => {
      const user = await createUser({ email: "forger@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_forge_1" });
      const { cookies } = await loginAs(app, "forger@example.com");

      vi.mocked(verifyPaymentSignature).mockReturnValueOnce(false);

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_forge_1",
        razorpay_payment_id: "pay_forge_1",
        razorpay_signature: "forged_signature",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Payment verification failed");

      // User should NOT be premium
      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.isPremium).toBe(false);
    });
  });

  // ─── ENROLLMENT AFTER PAYMENT ──────────────────────────────

  describe("ENROLLMENT AFTER PAYMENT", () => {
    it("enrollSubscriber enrolls in all published courses", async () => {
      // Create 3 published courses and 1 unpublished
      await prisma.course.createMany({
        data: [
          { title: "Course 1", slug: "course-1", isPublished: true, price: 0 },
          { title: "Course 2", slug: "course-2", isPublished: true, price: 0 },
          { title: "Course 3", slug: "course-3", isPublished: true, price: 0 },
          { title: "Draft Course", slug: "draft-course", isPublished: false, price: 0 },
        ],
      });

      const user = await createUser({ email: "subenroll@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_sub_1" });
      const { cookies } = await loginAs(app, "subenroll@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_sub_1",
        razorpay_payment_id: "pay_sub_1",
        razorpay_signature: "valid_sig",
      });

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments).toHaveLength(3);
    });

    it("enrollSubscriber is idempotent", async () => {
      await prisma.course.createMany({
        data: [
          { title: "Idem Course 1", slug: "idem-1", isPublished: true, price: 0 },
          { title: "Idem Course 2", slug: "idem-2", isPublished: true, price: 0 },
          { title: "Idem Course 3", slug: "idem-3", isPublished: true, price: 0 },
        ],
      });

      const user = await createUser({ email: "idemsub@example.com" });

      // First payment
      await createPayment({ userId: user.id, razorpayOrderId: "order_idem_a" });
      const { cookies } = await loginAs(app, "idemsub@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_idem_a",
        razorpay_payment_id: "pay_idem_a",
        razorpay_signature: "valid_sig",
      });

      // Second payment (simulating a re-verify scenario via webhook path)
      // The enrollSubscriber uses upsert, so calling it again should not create duplicates
      const { enrollSubscriber } = await import("../../lib/access.js");
      await enrollSubscriber(prisma, user.id);

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments).toHaveLength(3);
    });

    it("enrollSubscriber uses INDIVIDUAL accessSource", async () => {
      await prisma.course.createMany({
        data: [
          { title: "Src Course 1", slug: "src-1", isPublished: true, price: 0 },
          { title: "Src Course 2", slug: "src-2", isPublished: true, price: 0 },
        ],
      });

      const user = await createUser({ email: "srcsub@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_src_1" });
      const { cookies } = await loginAs(app, "srcsub@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_src_1",
        razorpay_payment_id: "pay_src_1",
        razorpay_signature: "valid_sig",
      });

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments.every((e) => e.accessSource === "INDIVIDUAL")).toBe(true);
    });
  });
});
