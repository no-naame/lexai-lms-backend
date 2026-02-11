import fp from "fastify-plugin";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(fastifyCookie);
});
