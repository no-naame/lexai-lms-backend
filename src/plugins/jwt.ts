import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: {
      cookieName: "access_token",
      signed: false,
    },
    sign: {
      expiresIn: "15m",
    },
  });
});
