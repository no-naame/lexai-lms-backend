import fp from "fastify-plugin";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
});
