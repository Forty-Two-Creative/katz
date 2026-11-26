import { prisma } from "@/lib/prisma";

/**
 * Links created through the API belong to a service account rather than to a
 * person. Deleting a User cascades to their links, so hanging Tiki's links off
 * whoever happened to set the integration up would mean that person leaving
 * silently breaks every short link the system ever issued.
 *
 * The default address is deliberately not a real mailbox: it can never be a
 * Google account, so nobody can sign in as it and inherit the links.
 */
export const SERVICE_USER_EMAIL = (
  process.env.KATZ_API_USER_EMAIL ?? "api@katz.service"
).toLowerCase();

const SERVICE_USER_NAME = "API — מערכות 42";

/** The service user's id, creating the row the first time the API is used. */
export async function serviceUserId(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: SERVICE_USER_EMAIL },
    update: {},
    create: { email: SERVICE_USER_EMAIL, name: SERVICE_USER_NAME },
    select: { id: true },
  });
  return user.id;
}

/**
 * The service user's id if it already exists, without creating it — so merely
 * loading the dashboard never conjures the account into being.
 */
export async function existingServiceUserId(): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: SERVICE_USER_EMAIL },
    select: { id: true },
  });
  return user?.id ?? null;
}
