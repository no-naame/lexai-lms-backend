import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireRole } from "../../hooks/rbac.js";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from "../../schemas/organization.js";
import { hashPassword } from "../../lib/passwords.js";

export default async function adminOrganizationRoutes(app: FastifyInstance) {
  // All routes require PLATFORM_ADMIN
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("PLATFORM_ADMIN"));

  // GET /admin/organizations - List all organizations
  app.get("/", {
    schema: {
      tags: ["Admin - Organizations"],
      summary: "List organizations",
      description: "List all organizations with member and student record counts.",
      security: [{ cookieAuth: [] }],
      response: {
        200: {
          description: "Organizations list",
          type: "object",
          properties: {
            organizations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string", example: "Acme University" },
                  slug: { type: "string", example: "acme-university" },
                  emailDomains: { type: "array", items: { type: "string" }, example: ["acme.edu"] },
                  isActive: { type: "boolean" },
                  contractStart: { type: "string", format: "date-time", nullable: true },
                  contractEnd: { type: "string", format: "date-time", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                  _count: { type: "object", properties: { members: { type: "integer" }, studentRecords: { type: "integer" } } },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgs = await app.prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true, studentRecords: true } },
      },
    });

    return reply.send({ organizations: orgs });
  });

  // GET /admin/organizations/:id - Get organization details
  app.get("/:id", {
    schema: {
      tags: ["Admin - Organizations"],
      summary: "Get organization details",
      description: "Get organization details including batches and counts of members, students, and course assignments.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string", description: "Organization CUID" } } },
      response: {
        200: { description: "Organization details", type: "object", properties: { organization: { type: "object", additionalProperties: true } } },
        404: { description: "Organization not found", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const org = await app.prisma.organization.findUnique({
      where: { id },
      include: {
        batches: true,
        _count: {
          select: {
            members: true,
            studentRecords: true,
            courseAccess: true,
          },
        },
      },
    });

    if (!org) {
      return reply.status(404).send({ error: "Organization not found" });
    }

    return reply.send({ organization: org });
  });

  // POST /admin/organizations - Create organization
  app.post("/", {
    schema: {
      tags: ["Admin - Organizations"],
      summary: "Create an organization",
      description: "Create a new organization for B2B institutional access. Email domains are used for auto-detection during Google OAuth login.",
      security: [{ cookieAuth: [] }],
      body: {
        type: "object",
        required: ["name", "slug", "emailDomains"],
        properties: {
          name: { type: "string", example: "Acme University" },
          slug: { type: "string", pattern: "^[a-z0-9-]+$", example: "acme-university" },
          emailDomains: { type: "array", items: { type: "string" }, example: ["acme.edu"] },
          contractStart: { type: "string", format: "date-time" },
          contractEnd: { type: "string", format: "date-time" },
        },
      },
      response: {
        201: { description: "Organization created", type: "object", properties: { organization: { type: "object", additionalProperties: true } } },
        400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
        409: { description: "Slug already in use", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const parsed = createOrganizationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, slug, emailDomains, contractStart, contractEnd } = parsed.data;

    // Check slug uniqueness
    const existing = await app.prisma.organization.findUnique({
      where: { slug },
    });
    if (existing) {
      return reply.status(409).send({ error: "Slug already in use" });
    }

    const org = await app.prisma.organization.create({
      data: {
        name,
        slug,
        emailDomains,
        contractStart: contractStart ? new Date(contractStart) : null,
        contractEnd: contractEnd ? new Date(contractEnd) : null,
      },
    });

    return reply.status(201).send({ organization: org });
  });

  // PATCH /admin/organizations/:id - Update organization
  app.patch("/:id", {
    schema: {
      tags: ["Admin - Organizations"],
      summary: "Update an organization",
      description: "Update organization properties. All fields are optional.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          emailDomains: { type: "array", items: { type: "string" } },
          isActive: { type: "boolean" },
          contractStart: { type: "string", format: "date-time" },
          contractEnd: { type: "string", format: "date-time" },
        },
      },
      response: {
        200: { description: "Organization updated", type: "object", properties: { organization: { type: "object", additionalProperties: true } } },
        400: { description: "Validation error", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateOrganizationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.contractStart) {
      data.contractStart = new Date(parsed.data.contractStart);
    }
    if (parsed.data.contractEnd) {
      data.contractEnd = new Date(parsed.data.contractEnd);
    }

    const org = await app.prisma.organization.update({
      where: { id },
      data,
    });

    return reply.send({ organization: org });
  });

  // POST /admin/organizations/:orgId/admins - Add institution admin
  app.post("/:orgId/admins", {
    schema: {
      tags: ["Admin - Organizations"],
      summary: "Add institution admin",
      description: "Add an institution admin to an organization. Creates the user account if it doesn't exist. If the user exists and is a STUDENT, promotes to INSTITUTION_ADMIN.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["orgId"], properties: { orgId: { type: "string" } } },
      body: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string", example: "Dr. Admin" },
          email: { type: "string", format: "email", example: "admin@acme.edu" },
          password: { type: "string", description: "Optional — if provided, sets the user's password" },
        },
      },
      response: {
        201: {
          description: "Admin added",
          type: "object",
          properties: {
            member: { type: "object", properties: { id: { type: "string" }, userId: { type: "string" }, organizationId: { type: "string" }, role: { type: "string", example: "ADMIN" }, isVerified: { type: "boolean" } } },
            userId: { type: "string" },
          },
        },
        400: { description: "Missing name or email", type: "object", properties: { error: { type: "string" } } },
        404: { description: "Organization not found", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const { name, email, password } = request.body as { name: string; email: string; password?: string };

    if (!name || !email) {
      return reply.status(400).send({ error: "Name and email required" });
    }

    const org = await app.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      return reply.status(404).send({ error: "Organization not found" });
    }

    // Find or create user
    let user = await app.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    const hashedPw = password ? await hashPassword(password) : null;

    if (!user) {
      user = await app.prisma.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          role: "INSTITUTION_ADMIN",
          emailVerified: new Date(), // Admin-created accounts are pre-verified
          ...(hashedPw ? { hashedPassword: hashedPw } : {}),
        },
      });
    } else {
      const updateData: Record<string, unknown> = {};
      if (user.role === "STUDENT") updateData.role = "INSTITUTION_ADMIN";
      if (hashedPw) updateData.hashedPassword = hashedPw;
      if (Object.keys(updateData).length > 0) {
        await app.prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    // Create organization membership
    const member = await app.prisma.organizationMember.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: orgId,
        },
      },
      create: {
        userId: user.id,
        organizationId: orgId,
        role: "ADMIN",
        isVerified: true,
      },
      update: {
        role: "ADMIN",
        isVerified: true,
      },
    });

    return reply.status(201).send({ member, userId: user.id });
  });
}
