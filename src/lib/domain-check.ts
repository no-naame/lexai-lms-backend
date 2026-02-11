import type { PrismaClient } from "@prisma/client";

const COMMON_PROVIDERS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
  "live.com",
  "mail.com",
  "zoho.com",
  "ymail.com",
  "proton.me",
  "pm.me",
  "hey.com",
  "fastmail.com",
  "tutanota.com",
  "gmx.com",
  "gmx.net",
]);

export function extractDomain(email: string): string {
  return email.split("@")[1]!.toLowerCase();
}

export function isCommonProvider(email: string): boolean {
  return COMMON_PROVIDERS.has(extractDomain(email));
}

export async function findOrganizationByEmail(
  prisma: PrismaClient,
  email: string
) {
  if (isCommonProvider(email)) {
    return null;
  }

  const domain = extractDomain(email);

  const org = await prisma.organization.findFirst({
    where: {
      emailDomains: { has: domain },
      isActive: true,
    },
  });

  return org;
}

export async function findStudentRecord(
  prisma: PrismaClient,
  organizationId: string,
  email: string
) {
  return prisma.studentRecord.findUnique({
    where: {
      organizationId_email: {
        organizationId,
        email: email.toLowerCase(),
      },
    },
    include: {
      batch: true,
    },
  });
}
