import type { FastifyInstance } from "fastify";
import { generateState, generateCodeVerifier } from "arctic";
import { google } from "../../lib/oauth.js";
import { issueTokens } from "../../lib/session.js";
import { findOrganizationByEmail } from "../../lib/domain-check.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || "";
const IS_TUNNEL = BACKEND_URL.includes("ngrok") || BACKEND_URL.includes("tunnel") || BACKEND_URL.includes("trycloudflare");
const COOKIE_SECURE = BACKEND_URL.startsWith("https://");
const COOKIE_SAME_SITE: "lax" | "none" = IS_TUNNEL ? "none" : "lax";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export default async function googleRoutes(app: FastifyInstance) {
  // GET /auth/google/login - Redirect to Google OAuth
  app.get(
    "/google/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Google OAuth login",
        description:
          "Initiate Google OAuth 2.0 flow. Redirects the user to Google's consent screen. Sets temporary httpOnly cookies (oauth_state, oauth_code_verifier) for CSRF protection and PKCE.",
        response: {
          302: { description: "Redirects to Google OAuth consent page" },
        },
      },
    },
    async (request, reply) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, [
      "openid",
      "profile",
      "email",
    ]);

    // Store state and code verifier in cookies for callback validation
    reply.setCookie("oauth_state", state, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: COOKIE_SAME_SITE,
      path: "/",
      maxAge: 600, // 10 minutes
      ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
    });

    reply.setCookie("oauth_code_verifier", codeVerifier, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: COOKIE_SAME_SITE,
      path: "/",
      maxAge: 600,
      ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
    });

    return reply.redirect(url.toString());
  });

  // GET /auth/google/callback - Handle Google OAuth callback
  app.get(
    "/google/callback",
    {
      schema: {
        tags: ["Auth"],
        summary: "Google OAuth callback",
        description:
          "Handle the redirect from Google after user consent. Exchanges authorization code for tokens, creates or links user account, issues JWT cookies, and redirects to the frontend. If the user's email domain matches an institution, redirects to the verification page.",
        querystring: {
          type: "object",
          properties: {
            code: { type: "string", description: "Authorization code from Google" },
            state: { type: "string", description: "OAuth state for CSRF protection" },
          },
        },
        response: {
          302: {
            description: "Redirects to frontend (/ on success, /login?error=oauth_failed on error)",
          },
        },
      },
    },
    async (request, reply) => {
    const { code, state } = request.query as {
      code?: string;
      state?: string;
    };

    const storedState = request.cookies.oauth_state;
    const codeVerifier = request.cookies.oauth_code_verifier;

    // Validate state and code
    if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
      return reply.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }

    // Clear OAuth cookies
    reply.clearCookie("oauth_state", { path: "/", ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }) });
    reply.clearCookie("oauth_code_verifier", { path: "/", ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }) });

    try {
      // Exchange code for tokens
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const accessToken = tokens.accessToken();

      // Fetch user profile from Google
      const userResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!userResponse.ok) {
        return reply.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
      }

      const googleUser = (await userResponse.json()) as {
        sub: string;
        name: string;
        email: string;
        email_verified: boolean;
        picture?: string;
      };

      // Find or create user
      let user = await app.prisma.user.findUnique({
        where: { email: googleUser.email },
      });

      if (user) {
        // Link Google account if not already linked
        await app.prisma.oAuthAccount.upsert({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: googleUser.sub,
            },
          },
          create: {
            userId: user.id,
            provider: "google",
            providerAccountId: googleUser.sub,
            accessToken: accessToken,
          },
          update: {
            accessToken: accessToken,
          },
        });

        // Ensure email is verified for Google users
        if (!user.emailVerified) {
          await app.prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: new Date() },
          });
        }
      } else {
        // Create new user
        user = await app.prisma.user.create({
          data: {
            name: googleUser.name,
            email: googleUser.email,
            emailVerified: new Date(),
            image: googleUser.picture,
            oauthAccounts: {
              create: {
                provider: "google",
                providerAccountId: googleUser.sub,
                accessToken: accessToken,
              },
            },
          },
        });
      }

      // Smart email domain check for institutional affiliation
      const org = await findOrganizationByEmail(app.prisma, user.email);
      let requiresInstitutionVerification = false;

      if (org) {
        // Check if already a member
        const existingMember = await app.prisma.organizationMember.findUnique({
          where: {
            userId_organizationId: {
              userId: user.id,
              organizationId: org.id,
            },
          },
        });

        if (!existingMember) {
          // Domain matches an org — always require enrollment ID verification
          // Don't auto-link even if student record exists (email alone isn't proof of identity)
          requiresInstitutionVerification = true;
        }
      }

      // Issue tokens
      await issueTokens(app, reply, user, app.prisma);

      // Redirect to frontend
      if (requiresInstitutionVerification) {
        return reply.redirect(
          `${FRONTEND_URL}/?tab=institution&verify=${org!.slug}`
        );
      }

      return reply.redirect(`${FRONTEND_URL}/`);
    } catch (error) {
      app.log.error(error, "Google OAuth callback error");
      return reply.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }
  });
}
