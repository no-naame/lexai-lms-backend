import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "LexAI LMS API",
        description:
          "Complete REST API for the LexAI Learning Management System. " +
          "Supports B2C (individual subscription) and B2B (institutional) access models, " +
          "JWT-based authentication with httpOnly cookies, role-based access control, " +
          "and comprehensive course content management.",
        version: "1.0.0",
        contact: {
          name: "LexAI LMS",
        },
      },
      servers: [
        {
          url: "http://localhost:4000",
          description: "Local development server",
        },
        ...(process.env.BACKEND_URL && process.env.BACKEND_URL !== "http://localhost:4000"
          ? [{
              url: process.env.BACKEND_URL,
              description: "Tunnel server (ngrok)",
            }]
          : []),
      ],
      tags: [
        { name: "Health", description: "Health check endpoint" },
        {
          name: "Auth",
          description:
            "Authentication — register, login, logout, token refresh, password reset, email verification, Google OAuth",
        },
        {
          name: "Auth - Institution",
          description:
            "Institution verification — enrollment ID verification and status check",
        },
        {
          name: "Courses",
          description:
            "Public course catalog — list published courses, get course details, list enrolled courses",
        },
        {
          name: "Lessons",
          description:
            "Lesson content delivery — access lesson content (free/paid gating), update progress, get course progress",
        },
        {
          name: "Admin - Courses",
          description:
            "Admin course CRUD — create, update, delete courses (PLATFORM_ADMIN only)",
        },
        {
          name: "Admin - Modules",
          description:
            "Admin module CRUD — create, update, delete, reorder modules (PLATFORM_ADMIN only)",
        },
        {
          name: "Admin - Lessons",
          description:
            "Admin lesson CRUD — create, update, delete, reorder lessons (PLATFORM_ADMIN only)",
        },
        {
          name: "Admin - Organizations",
          description:
            "Admin organization management — create, update, list organizations and add org admins (PLATFORM_ADMIN only)",
        },
        {
          name: "Admin - Users",
          description:
            "Admin user management — list users, update roles and status (PLATFORM_ADMIN only)",
        },
        {
          name: "Institutions - Students",
          description:
            "Institution student management — list and delete student records, upload CSV (Org ADMIN only)",
        },
        {
          name: "Institutions - Courses",
          description:
            "Institution course access — assign/remove course access for org or batch (Org ADMIN only)",
        },
        {
          name: "User",
          description:
            "User routes — enrollments, lesson progress, and course completion tracking (authenticated users)",
        },
        {
          name: "Admin - Videos",
          description:
            "Admin video management — upload videos via Gumlet, check status, list and delete video assets (PLATFORM_ADMIN only)",
        },
        {
          name: "Payments",
          description:
            "Payment processing — create orders, verify payments, check premium status (authenticated users)",
        },
        {
          name: "Webhooks",
          description:
            "Webhook endpoints — receive callbacks from external services (Gumlet video processing, Razorpay payment status)",
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "access_token",
            description:
              "JWT access token stored in httpOnly cookie. Obtained via POST /auth/login or GET /auth/google/callback.",
          },
        },
        schemas: {
          Error: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          ValidationError: {
            type: "object",
            properties: {
              error: { type: "string" },
              details: { type: "object" },
            },
          },
          User: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string", format: "email" },
              image: { type: "string", nullable: true },
              role: {
                type: "string",
                enum: [
                  "PLATFORM_ADMIN",
                  "INSTITUTION_ADMIN",
                  "INSTRUCTOR",
                  "STUDENT",
                ],
              },
              emailVerified: {
                type: "string",
                format: "date-time",
                nullable: true,
              },
              isActive: { type: "boolean" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          Membership: {
            type: "object",
            properties: {
              organizationId: { type: "string" },
              organizationName: { type: "string" },
              role: { type: "string", enum: ["ADMIN", "STUDENT"] },
              isVerified: { type: "boolean" },
              batchId: { type: "string", nullable: true },
            },
          },
          Course: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              slug: { type: "string" },
              description: { type: "string", nullable: true },
              thumbnail: { type: "string", nullable: true },
              introVideoUrl: { type: "string", nullable: true },
              price: { type: "number" },
              isPublished: { type: "boolean" },
            },
          },
          CourseCatalogItem: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              slug: { type: "string" },
              description: { type: "string", nullable: true },
              thumbnail: { type: "string", nullable: true },
              price: { type: "number" },
              moduleCount: { type: "integer" },
              lessonCount: { type: "integer" },
            },
          },
          Module: {
            type: "object",
            properties: {
              id: { type: "string" },
              courseId: { type: "string" },
              title: { type: "string" },
              description: { type: "string", nullable: true },
              order: { type: "integer" },
            },
          },
          Lesson: {
            type: "object",
            properties: {
              id: { type: "string" },
              moduleId: { type: "string" },
              title: { type: "string" },
              description: { type: "string", nullable: true },
              order: { type: "integer" },
              type: { type: "string", enum: ["VIDEO", "ARTICLE"] },
              isFree: { type: "boolean" },
              videoUrl: { type: "string", nullable: true },
              content: { type: "string", nullable: true },
              duration: { type: "integer" },
            },
          },
          Organization: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              slug: { type: "string" },
              emailDomains: {
                type: "array",
                items: { type: "string" },
              },
              isActive: { type: "boolean" },
              contractStart: {
                type: "string",
                format: "date-time",
                nullable: true,
              },
              contractEnd: {
                type: "string",
                format: "date-time",
                nullable: true,
              },
            },
          },
          StudentRecord: {
            type: "object",
            properties: {
              id: { type: "string" },
              organizationId: { type: "string" },
              email: { type: "string" },
              name: { type: "string", nullable: true },
              enrollmentId: { type: "string" },
              batchId: { type: "string", nullable: true },
              isClaimed: { type: "boolean" },
              claimedByUserId: { type: "string", nullable: true },
            },
          },
          Pagination: {
            type: "object",
            properties: {
              page: { type: "integer" },
              limit: { type: "integer" },
              total: { type: "integer" },
              totalPages: { type: "integer" },
            },
          },
        },
      },
    },
  });

  // Scalar API Reference — modern, interactive API documentation
  await fastify.register(import("@scalar/fastify-api-reference"), {
    routePrefix: "/docs",
    configuration: {
      title: "LexAI LMS API",
      theme: "kepler",
    },
  });
});
