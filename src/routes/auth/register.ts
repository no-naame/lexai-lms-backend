import type { FastifyInstance } from "fastify";
import { registerSchema } from "../../schemas/auth.js";
import { hashPassword } from "../../lib/passwords.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { sendVerificationEmail } from "../../lib/email.js";

export default async function registerRoutes(app: FastifyInstance) {
  app.post(
    "/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["Auth"],
        summary: "Register",
        description:
          "Create a new user account. Sends a verification email with a link that expires in 24 hours. Password is hashed with bcrypt before storage.",
        body: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100, example: "Jane Smith" },
            email: { type: "string", format: "email", maxLength: 255, example: "jane@example.com" },
            password: {
              type: "string",
              minLength: 8,
              maxLength: 128,
              example: "securepass123",
              description: "Must be 8-128 characters",
            },
          },
        },
        response: {
          201: {
            description: "Account created. Verification email sent.",
            type: "object",
            properties: {
              success: { type: "boolean", example: true },
              message: {
                type: "string",
                example: "Account created. Please check your email to verify your account.",
              },
            },
          },
          400: {
            description: "Validation error (short password, invalid email, empty name)",
            type: "object",
            properties: {
              error: { type: "string", example: "Validation failed" },
              details: { type: "object", additionalProperties: true },
            },
          },
          409: {
            description: "Email already registered",
            type: "object",
            properties: { error: { type: "string", example: "An account with this email already exists" } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { name, email, password } = parsed.data;

      // Check if email already taken
      const existing = await app.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existing) {
        return reply.status(409).send({
          error: "An account with this email already exists",
        });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);

      await app.prisma.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          hashedPassword,
        },
      });

      // Generate email verification token
      const rawToken = generateToken();
      const hashedTokenValue = hashToken(rawToken);

      await app.prisma.emailVerificationToken.create({
        data: {
          email: email.toLowerCase(),
          token: hashedTokenValue,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      // Send verification email
      try {
        await sendVerificationEmail(email, rawToken);
      } catch (err) {
        app.log.error(err, "Failed to send verification email");
      }

      return reply.status(201).send({
        success: true,
        message: "Account created. Please check your email to verify your account.",
      });
    }
  );
}
