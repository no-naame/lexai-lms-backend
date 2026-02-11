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

import { createOrder, verifyPaymentSignature } from "../../lib/razorpay.js";

describe("INTEGRATION — PAYMENTS", () => {
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
    vi.mocked(createOrder).mockResolvedValue({
      id: "order_test_123",
      amount: 49900,
      currency: "INR",
      receipt: "receipt_test",
    } as any);
    vi.mocked(verifyPaymentSignature).mockReturnValue(true);
  });

  // ─── POST /payments/create-order ────────────────────────────

  describe("POST /payments/create-order", () => {
    it("creates Razorpay order and returns order details", async () => {
      await createUser({ email: "buyer@example.com" });
      const { cookies } = await loginAs(app, "buyer@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.orderId).toBe("order_test_123");
      expect(body.amount).toBe(49900);
      expect(body.currency).toBe("INR");
      expect(body.keyId).toBe("rzp_test_key");
    });

    it("creates Payment record in DB with status 'created'", async () => {
      const user = await createUser({ email: "dbcheck@example.com" });
      const { cookies } = await loginAs(app, "dbcheck@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/create-order");

      const payment = await prisma.payment.findFirst({
        where: { userId: user.id },
      });
      expect(payment).toBeTruthy();
      expect(payment!.razorpayOrderId).toBe("order_test_123");
      expect(payment!.amount).toBe(49900);
      expect(payment!.status).toBe("created");
    });

    it("returns 400 if user is already premium", async () => {
      await createUser({ email: "premium@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "premium@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("You already have premium access");
    });

    it("returns 400 if user is a verified org member", async () => {
      const user = await createUser({ email: "orgmember@example.com" });
      const org = await createOrganization({ name: "Test Uni", slug: "test-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "orgmember@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("You already have access through your institution");
    });

    it("allows create-order if org membership is unverified", async () => {
      const user = await createUser({ email: "unverified@example.com" });
      const org = await createOrganization({ name: "Unverified Uni", slug: "unverified-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: false,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "unverified@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(200);
    });

    it("allows create-order if org is inactive", async () => {
      const user = await createUser({ email: "inactiveorg@example.com" });
      const org = await createOrganization({
        name: "Inactive Uni",
        slug: "inactive-uni",
        isActive: false,
      });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "inactiveorg@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 if not authenticated", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/payments/create-order",
      });
      expect(res.statusCode).toBe(401);
    });

    it("uses PLATFORM_PRICE env var for amount", async () => {
      process.env.PLATFORM_PRICE = "99900";

      await createUser({ email: "pricechk@example.com" });
      const { cookies } = await loginAs(app, "pricechk@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/create-order");
      expect(res.statusCode).toBe(200);
      expect(res.json().amount).toBe(99900);

      // Reset
      process.env.PLATFORM_PRICE = "49900";
    });
  });

  // ─── POST /payments/verify ──────────────────────────────────

  describe("POST /payments/verify", () => {
    it("verifies payment and grants premium access", async () => {
      const user = await createUser({ email: "verify@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_verify_1" });
      const { cookies } = await loginAs(app, "verify@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_verify_1",
        razorpay_payment_id: "pay_test_1",
        razorpay_signature: "valid_sig",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updated!.isPremium).toBe(true);
    });

    it("creates enrollments in all published courses", async () => {
      const user = await createUser({ email: "enrollall@example.com" });
      await seedCourseWithModulesAndLessons();
      await createPayment({ userId: user.id, razorpayOrderId: "order_enroll_1" });
      const { cookies } = await loginAs(app, "enrollall@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_enroll_1",
        razorpay_payment_id: "pay_test_2",
        razorpay_signature: "valid_sig",
      });

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: user.id },
      });
      expect(enrollments.length).toBeGreaterThanOrEqual(1);
      expect(enrollments.every((e) => e.accessSource === "INDIVIDUAL")).toBe(true);
    });

    it("returns 400 for invalid signature", async () => {
      const user = await createUser({ email: "badsig@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_badsig_1" });
      const { cookies } = await loginAs(app, "badsig@example.com");

      vi.mocked(verifyPaymentSignature).mockReturnValueOnce(false);

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_badsig_1",
        razorpay_payment_id: "pay_test_3",
        razorpay_signature: "invalid_sig",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Payment verification failed");
    });

    it("returns 404 for nonexistent order_id", async () => {
      await createUser({ email: "noorder@example.com" });
      const { cookies } = await loginAs(app, "noorder@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_nonexistent",
        razorpay_payment_id: "pay_test_4",
        razorpay_signature: "sig",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Payment not found");
    });

    it("returns 404 if payment belongs to different user", async () => {
      const userA = await createUser({ email: "usera@example.com" });
      await createUser({ email: "userb@example.com" });
      await createPayment({ userId: userA.id, razorpayOrderId: "order_usera_1" });
      const { cookies: cookiesB } = await loginAs(app, "userb@example.com");

      const res = await injectWithAuth(app, cookiesB, "POST", "/payments/verify", {
        razorpay_order_id: "order_usera_1",
        razorpay_payment_id: "pay_test_5",
        razorpay_signature: "sig",
      });

      expect(res.statusCode).toBe(404);
    });

    it("idempotent — returns success if already paid", async () => {
      const user = await createUser({ email: "idempotent@example.com" });
      await createPayment({
        userId: user.id,
        razorpayOrderId: "order_idempotent_1",
        razorpayPaymentId: "pay_already",
        status: "paid",
      });
      const { cookies } = await loginAs(app, "idempotent@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_idempotent_1",
        razorpay_payment_id: "pay_already",
        razorpay_signature: "sig",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe("Payment already verified");
    });

    it("updates Payment record status to 'paid'", async () => {
      const user = await createUser({ email: "statuschk@example.com" });
      await createPayment({ userId: user.id, razorpayOrderId: "order_statuschk_1" });
      const { cookies } = await loginAs(app, "statuschk@example.com");

      await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_statuschk_1",
        razorpay_payment_id: "pay_test_7",
        razorpay_signature: "valid_sig",
      });

      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: "order_statuschk_1" },
      });
      expect(payment!.status).toBe("paid");
      expect(payment!.razorpayPaymentId).toBe("pay_test_7");
    });

    it("returns 401 if not authenticated", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/payments/verify",
        payload: {
          razorpay_order_id: "order_x",
          razorpay_payment_id: "pay_x",
          razorpay_signature: "sig_x",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 if required fields are missing", async () => {
      await createUser({ email: "missing@example.com" });
      const { cookies } = await loginAs(app, "missing@example.com");

      const res = await injectWithAuth(app, cookies, "POST", "/payments/verify", {
        razorpay_order_id: "order_missing",
        // missing razorpay_payment_id and razorpay_signature
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /payments/status ───────────────────────────────────

  describe("GET /payments/status", () => {
    it("returns no access for new user", async () => {
      await createUser({ email: "fresh@example.com" });
      const { cookies } = await loginAs(app, "fresh@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/payments/status");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.hasAccess).toBe(false);
      expect(body.accessType).toBeNull();
      expect(body.isPremium).toBe(false);
      expect(body.organization).toBeNull();
      expect(body.latestPayment).toBeNull();
    });

    it("returns premium access for isPremium user", async () => {
      await createUser({ email: "premstat@example.com", isPremium: true });
      const { cookies } = await loginAs(app, "premstat@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/payments/status");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.hasAccess).toBe(true);
      expect(body.accessType).toBe("premium");
      expect(body.isPremium).toBe(true);
    });

    it("returns institution access for verified org member", async () => {
      const user = await createUser({ email: "instaccess@example.com" });
      const org = await createOrganization({ name: "Test University", slug: "test-university-status" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "instaccess@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/payments/status");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.hasAccess).toBe(true);
      expect(body.accessType).toBe("institution");
      expect(body.organization).toBe("Test University");
    });

    it("returns latest payment info", async () => {
      const user = await createUser({ email: "payinfo@example.com" });
      await createPayment({
        userId: user.id,
        razorpayOrderId: "order_info_1",
        amount: 49900,
        status: "created",
      });
      const { cookies } = await loginAs(app, "payinfo@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/payments/status");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.latestPayment).toBeTruthy();
      expect(body.latestPayment.status).toBe("created");
      expect(body.latestPayment.amount).toBe(49900);
      expect(body.latestPayment.createdAt).toBeTruthy();
    });

    it("premium takes priority over institution", async () => {
      const user = await createUser({ email: "both@example.com", isPremium: true });
      const org = await createOrganization({ name: "Both Uni", slug: "both-uni" });
      await createOrgMember({
        userId: user.id,
        organizationId: org.id,
        isVerified: true,
        isActive: true,
      });
      const { cookies } = await loginAs(app, "both@example.com");

      const res = await injectWithAuth(app, cookies, "GET", "/payments/status");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.accessType).toBe("premium");
    });

    it("returns 401 if not authenticated", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/payments/status",
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
