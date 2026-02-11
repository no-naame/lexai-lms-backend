import Fastify from "fastify";
import cookiePlugin from "./plugins/cookie.js";
import corsPlugin from "./plugins/cors.js";
import jwtPlugin from "./plugins/jwt.js";
import prismaPlugin from "./plugins/prisma.js";
import rateLimitPlugin from "./plugins/rate-limit.js";
import swaggerPlugin from "./plugins/swagger.js";
import authRoutes from "./routes/auth/index.js";
import adminRoutes from "./routes/admin/organizations.js";
import adminUsersRoutes from "./routes/admin/users.js";
import institutionStudentsRoutes from "./routes/institutions/students.js";
import institutionUploadRoutes from "./routes/institutions/upload.js";
import institutionCoursesRoutes from "./routes/institutions/courses.js";
import coursesRoutes from "./routes/courses/index.js";
import lessonRoutes from "./routes/courses/lessons.js";
import adminCourseRoutes from "./routes/courses/admin.js";
import userRoutes from "./routes/user/index.js";
import adminVideoRoutes from "./routes/admin/videos.js";
import gumletWebhookRoutes from "./routes/webhooks/gumlet.js";
import paymentRoutes from "./routes/payments/index.js";
import razorpayWebhookRoutes from "./routes/webhooks/razorpay.js";
import responseWrapperPlugin from "./hooks/response-wrapper.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "warn" : "info",
    },
    trustProxy: true,
    ajv: {
      customOptions: {
        keywords: ["example"],
      },
    },
  });

  // Register plugins (order matters: cookie before jwt, swagger before routes)
  await app.register(cookiePlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);
  await app.register(jwtPlugin);
  await app.register(prismaPlugin);
  await app.register(swaggerPlugin);

  // Health check
  app.get("/health", {
    schema: {
      tags: ["Health"],
      summary: "Health check",
      description: "Simple health check endpoint. Returns 200 if the server is running. No authentication required.",
      response: {
        200: {
          description: "Server is healthy",
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
          },
        },
      },
    },
  }, async () => ({ status: "ok" }));

  // Readiness check (verifies DB connectivity)
  app.get("/health/ready", {
    schema: {
      tags: ["Health"],
      summary: "Readiness check",
      description: "Checks server and database connectivity. Returns 200 if both are healthy.",
      response: {
        200: {
          description: "Server and database are healthy",
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            db: { type: "string", example: "ok" },
          },
        },
        503: {
          description: "Database is unreachable",
          type: "object",
          properties: {
            status: { type: "string", example: "error" },
            db: { type: "string", example: "unreachable" },
          },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "ok" };
    } catch {
      return reply.status(503).send({ status: "error", db: "unreachable" });
    }
  });

  // Response wrapper (scoped to /courses and /user)
  await app.register(responseWrapperPlugin);

  // Register routes
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(adminRoutes, { prefix: "/admin/organizations" });
  await app.register(adminUsersRoutes, { prefix: "/admin/users" });
  await app.register(institutionStudentsRoutes, { prefix: "/institutions/:orgId/students" });
  await app.register(institutionUploadRoutes, { prefix: "/institutions/:orgId/students" });
  await app.register(institutionCoursesRoutes, { prefix: "/institutions/:orgId/courses" });
  await app.register(coursesRoutes, { prefix: "/courses" });
  await app.register(lessonRoutes, { prefix: "/courses" });
  await app.register(adminCourseRoutes, { prefix: "/admin/courses" });
  await app.register(userRoutes, { prefix: "/user" });
  await app.register(adminVideoRoutes, { prefix: "/admin/videos" });
  await app.register(gumletWebhookRoutes, { prefix: "/webhooks" });
  await app.register(paymentRoutes, { prefix: "/payments" });
  await app.register(razorpayWebhookRoutes, { prefix: "/webhooks" });

  return app;
}
