import { prisma } from "@/lib/prisma";
import { refererSource } from "@/lib/url";
import { isBot } from "@/lib/bots";
import { isPossibleSlug } from "@/lib/slug";
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

/**
 * Postgres is unreachable and this slug wasn't cached, so the destination is
 * genuinely unknown. Answer honestly with a retryable error rather than a
 * misleading "not found" — and crucially, never cache this outcome: a database
 * failure is not evidence that the link is missing, and caching it would
 * blackhole a real link for the lifetime of the entry.
 */
function unavailable(): Response {
  return new Response(
    '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">' +
      '<title>רגע, לא זמין</title>' +
      '<div style="font-family:system-ui,sans-serif;text-align:center;padding:15vh 1.5rem">' +
      '<h1 style="font-size:1.5rem;margin:0 0 .5rem">הלינק לא זמין כרגע</h1>' +
      '<p style="color:#666;margin:0">נסו שוב בעוד רגע.</p></div>',
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": "60",
        "cache-control": "no-store",
      },
    },
  );
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

  // Asset-looking paths (favicon.ico, meta.json) can never be slugs, so reject
  // them before spending a Redis or database call.
  if (!isPossibleSlug(slug)) {
    return new Response("Not found", { status: 404 });
  }

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
    let row;
    try {
      row = await prisma.link.findUnique({
        where: { slug },
        select: { id: true, url: true, disabled: true, expiresAt: true },
      });
    } catch {
      // Database down or over quota. Redis still serves every cached link, so
      // this only affects slugs that happen to be cold.
      return unavailable();
    }
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
