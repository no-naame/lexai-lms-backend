import type { FastifyInstance } from "fastify";
import { authenticate } from "../../hooks/auth.js";
import { requireRole } from "../../hooks/rbac.js";

export default async function adminUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("PLATFORM_ADMIN"));

  // GET /admin/users - List all users
  app.get("/", {
    schema: {
      tags: ["Admin - Users"],
      summary: "List users",
      description: "List all users with pagination and search. Search is case-insensitive and matches name or email.",
      security: [{ cookieAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          page: { type: "string", default: "1", description: "Page number (1-based)" },
          limit: { type: "string", default: "20", description: "Items per page (1-100)" },
          search: { type: "string", description: "Search by name or email" },
        },
      },
      response: {
        200: {
          description: "Paginated user list",
          type: "object",
          properties: {
            users: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string", enum: ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "INSTRUCTOR", "STUDENT"] },
                  isActive: { type: "boolean" },
                  emailVerified: { type: "string", format: "date-time", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                  _count: { type: "object", properties: { organizationMembers: { type: "integer" } } },
                },
              },
            },
            pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { page = "1", limit = "20", search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      app.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          _count: { select: { organizationMembers: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      app.prisma.user.count({ where }),
    ]);

    return reply.send({
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // PATCH /admin/users/:id - Update user (role, active status)
  app.patch("/:id", {
    schema: {
      tags: ["Admin - Users"],
      summary: "Update user role or status",
      description: "Update a user's role or active status. Used for promoting users, deactivating accounts, etc.",
      security: [{ cookieAuth: [] }],
      params: { type: "object", required: ["id"], properties: { id: { type: "string", description: "User CUID" } } },
      body: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "INSTRUCTOR", "STUDENT"] },
          isActive: { type: "boolean" },
        },
      },
      response: {
        200: {
          description: "User updated",
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                role: { type: "string" },
                isActive: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { role, isActive } = request.body as {
      role?: string;
      isActive?: boolean;
    };

    const data: Record<string, unknown> = {};
    if (role) data.role = role;
    if (typeof isActive === "boolean") data.isActive = isActive;

    const user = await app.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return reply.send({ user });
  });
}
