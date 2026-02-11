import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

/**
 * Response wrapper hook — scoped to /courses and /user prefixes.
 * Wraps successful JSON responses in { success: true, data: {...} }
 * and error responses in { success: false, error: { code, message, statusCode } }.
 */
async function responseWrapperPlugin(app: FastifyInstance) {
  app.addHook(
    "onSend",
    async (request: FastifyRequest, reply: FastifyReply, payload: string) => {
      const url = request.url;

      // Only wrap /courses and /user prefixed routes
      if (!url.startsWith("/courses") && !url.startsWith("/user")) {
        return payload;
      }

      // Only wrap JSON responses
      const contentType = reply.getHeader("content-type");
      if (
        !contentType ||
        !(typeof contentType === "string" && contentType.includes("application/json"))
      ) {
        return payload;
      }

      if (!payload || payload === "null") {
        return payload;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return payload;
      }

      // Already wrapped — skip
      if (parsed && typeof parsed === "object" && "success" in parsed) {
        return payload;
      }

      const statusCode = reply.statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        return JSON.stringify({
          success: true,
          data: parsed,
        });
      } else {
        // Error response
        return JSON.stringify({
          success: false,
          error: {
            code: parsed?.error ?? "ERROR",
            message: parsed?.error ?? parsed?.message ?? "An error occurred",
            statusCode,
          },
        });
      }
    }
  );
}

export default fp(responseWrapperPlugin, {
  name: "response-wrapper",
});
