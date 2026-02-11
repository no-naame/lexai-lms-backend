import { Resend } from "resend";
import nodemailer from "nodemailer";

const FROM = process.env.EMAIL_FROM || "noreply@lexai.com";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const isDev = process.env.NODE_ENV !== "production";

// Development: Nodemailer → Mailpit (localhost:1025)
// Production: Resend API
const devTransport = nodemailer.createTransport({
  host: "localhost",
  port: 1025,
  secure: false,
});

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to: string, subject: string, html: string) {
  if (isDev) {
    await devTransport.sendMail({ from: FROM, to, subject, html });
    console.log(`[EMAIL] Sent to ${to} — view at http://localhost:8025`);
  } else {
    await resend.emails.send({ from: FROM, to, subject, html });
  }
}

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${process.env.BACKEND_URL || "http://localhost:4000"}/auth/verify-email?token=${token}`;

  await sendEmail(
    email,
    "Verify your email - LexAI LMS",
    `
      <h2>Welcome to LexAI LMS</h2>
      <p>Click the link below to verify your email address:</p>
      <a href="${verifyUrl}">Verify Email</a>
      <p>This link expires in 24 hours.</p>
      <p>If you didn't create an account, you can ignore this email.</p>
    `
  );
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

  await sendEmail(
    email,
    "Reset your password - LexAI LMS",
    `
      <h2>Password Reset</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request a password reset, you can ignore this email.</p>
    `
  );
}
