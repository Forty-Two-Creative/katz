import { timingSafeEqual } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { createLinkRecord } from "@/lib/create-link";
import { normalizeClientId } from "@/lib/client-id";
import { serviceUserId } from "@/lib/service-user";

export const dynamic = "force-dynamic";

/**
 * Creates a short link on behalf of another 42 system (Tiki, the portal, …).
 *
 * Authentication is the `Authorization` header and nothing else: no token in
 * the query string, where it would end up in access logs and in `Referer`, and
 * no falling back to the browser session when the header is missing. A caller
 * without a valid token gets 401, full stop — otherwise this route would be a
 * second, quieter door into an app whose front door is a gated Google login.
 */

function tokenMatches(header: string | null, expected: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  // timingSafeEqual throws when the lengths differ, so check that first.
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** Reads a field that is only meaningful as a string, ignoring anything else. */
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: Request) {
  const expected = process.env.KATZ_API_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "KATZ_API_TOKEN is not configured" },
      { status: 503 },
    );
  }
  if (!tokenMatches(request.headers.get("authorization"), expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "גוף הבקשה חייב להיות אובייקט JSON" },
      { status: 400 },
    );
  }

  const url = str(body.url)?.trim();
  if (!url) return Response.json({ error: "חסר שדה url" }, { status: 400 });

  const client = normalizeClientId(body.clientId);
  if ("error" in client) {
    return Response.json({ error: client.error }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  const rawExpiry = str(body.expiresAt)?.trim();
  if (rawExpiry) {
    const parsedExpiry = new Date(rawExpiry);
    if (Number.isNaN(parsedExpiry.getTime())) {
      return Response.json(
        { error: "expiresAt אינו תאריך תקין (ISO 8601)" },
        { status: 400 },
      );
    }
    expiresAt = parsedExpiry;
  }

  // Accept both `{ utm: { source } }` and `{ utm: { utm_source } }`, because
  // the calling system may already hold the parameters under their full names.
  const utmRaw = (
    body.utm && typeof body.utm === "object" && !Array.isArray(body.utm)
      ? body.utm
      : {}
  ) as Record<string, unknown>;
  const utm = {
    source: str(utmRaw.source) ?? str(utmRaw.utm_source),
    medium: str(utmRaw.medium) ?? str(utmRaw.utm_medium),
    campaign: str(utmRaw.campaign) ?? str(utmRaw.utm_campaign),
    term: str(utmRaw.term) ?? str(utmRaw.utm_term),
    content: str(utmRaw.content) ?? str(utmRaw.utm_content),
  };

  const result = await createLinkRecord({
    ownerId: await serviceUserId(),
    url,
    title: str(body.title) ?? null,
    slug: str(body.slug) ?? null,
    clientId: client.value,
    expiresAt,
    utm,
  });

  if (!result.ok) {
    const status =
      result.reason === "taken" ? 409 : result.reason === "failed" ? 500 : 400;
    return Response.json({ error: result.error }, { status });
  }

  const baseUrl = await getBaseUrl();
  return Response.json(
    { id: result.id, slug: result.slug, shortUrl: `${baseUrl}/${result.slug}` },
    { status: 201 },
  );
}
