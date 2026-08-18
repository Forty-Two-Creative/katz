import { prisma } from "@/lib/prisma";
import { refererSource } from "@/lib/url";
import { isBot } from "@/lib/bots";
import {
  cacheLink,
  getCachedLink,
  queueClick,
  type CachedLink,
} from "@/lib/link-cache";

export const dynamic = "force-dynamic";

function deviceFromUa(ua: string | null): string {
  if (!ua) return "לא ידוע";
  return /mobile|android|iphone|ipad|ipod/i.test(ua) ? "מובייל" : "מחשב";
}

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function bounce(request: Request, reason: string, slug: string): Response {
  const origin = new URL(request.url).origin;
  return Response.redirect(
    `${origin}/?${reason}=${encodeURIComponent(slug)}`,
    302,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Fast path: Redis. Falls through to Postgres only on a cold cache, which
  // explicit invalidation on every mutation keeps rare.
  let link: CachedLink | null = null;
  const cached = await getCachedLink(slug);

  if (cached.status === "hit") {
    link = cached.link;
  } else if (cached.status === "miss") {
    // Known-bad slug. Don't wake the database for it.
    return bounce(request, "notfound", slug);
  } else {
    const row = await prisma.link.findUnique({
      where: { slug },
      select: { id: true, url: true, disabled: true, expiresAt: true },
    });
    link = row
      ? {
          id: row.id,
          url: row.url,
          disabled: row.disabled,
          expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
        }
      : null;
    await cacheLink(slug, link);
  }

  if (!link) return bounce(request, "notfound", slug);
  if (link.disabled) return bounce(request, "disabled", slug);
  if (link.expiresAt !== null && link.expiresAt < Date.now()) {
    return bounce(request, "expired", slug);
  }

  const headers = request.headers;
  const userAgent = headers.get("user-agent");

  // Record the click — best-effort, and never for automated traffic.
  if (!isBot(userAgent)) {
    const referer = headers.get("referer");
    const click = {
      l: link.id,
      t: Date.now(),
      r: referer ?? undefined,
      s: refererSource(referer) ?? undefined,
      c: headers.get("x-vercel-ip-country") ?? undefined,
      y: safeDecode(headers.get("x-vercel-ip-city")) ?? undefined,
      d: deviceFromUa(userAgent),
    };

    const buffered = await queueClick(click);

    // Redis unavailable or not configured: write straight to Postgres so
    // analytics still work, exactly as they did before the cache existed.
    if (!buffered) {
      try {
        await prisma.click.create({
          data: {
            linkId: click.l,
            createdAt: new Date(click.t),
            referer: click.r ?? null,
            source: click.s ?? null,
            country: click.c ?? null,
            city: click.y ?? null,
            device: click.d ?? null,
          },
        });
      } catch {
        /* swallow — redirecting matters more than analytics */
      }
    }
  }

  return Response.redirect(link.url, 302);
}
