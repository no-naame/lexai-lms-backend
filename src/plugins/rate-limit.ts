import fp from "fastify-plugin";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(fastifyRateLimit, {
    max: 1000,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      return (req.headers["cf-connecting-ip"] as string)
        || req.headers["x-forwarded-for"]?.toString().split(",")[0].trim()
        || req.ip;
    },
  });
});
