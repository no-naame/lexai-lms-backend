import fp from "fastify-plugin";
import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  const backendUrl = process.env.BACKEND_URL || "";
  const isTunnel = backendUrl.includes("ngrok") || backendUrl.includes("tunnel") || backendUrl.includes("trycloudflare");

  fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman, mobile apps)
      if (!origin) return cb(null, true);
      // Always allow the configured frontend URL
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      if (origin === frontendUrl) return cb(null, true);
      // In dev/tunnel mode, allow any localhost origin (any port)
      if (process.env.NODE_ENV !== "production" || isTunnel) {
        if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) return cb(null, true);
      }
      cb(new Error("CORS not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
  });
});
