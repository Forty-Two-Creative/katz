/**
 * Redis layer that keeps the redirect path off Postgres.
 *
 * Why this exists: Neon bills for time the compute is awake, not for query
 * work. Traffic arriving every ~54s meant the 5-minute autosuspend never fired
 * and the database was billed ~22h/day to serve a handful of milliseconds of
 * real work. Redirects now read from Redis and clicks are buffered there, so
 * Postgres only wakes when someone opens the dashboard or the daily cron runs.
 */

import { redis, redisEnabled } from "@/lib/redis";

const PREFIX = "katz";
const linkKey = (slug: string) => `${PREFIX}:link:${slug}`;
const pendingKey = (linkId: string) => `${PREFIX}:pending:${linkId}`;

/** The queue of clicks waiting to be written to Postgres. */
export const QUEUE_KEY = `${PREFIX}:clicks`;

/**
 * Cached links live a long time because every mutation invalidates explicitly
 * (see invalidateLink). Long TTLs mean cold misses — and therefore Postgres
 * wake-ups — are rare.
 */
const HIT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Unknown slugs are cached too, for much less time. Short domains attract
 * constant slug probing; without this, every bogus request would wake Neon.
 */
const MISS_TTL_SECONDS = 10 * 60;

/** Sentinel stored for slugs that don't exist. */
const MISS = "0";

/** The subset of a link the redirect actually needs. */
export type CachedLink = {
  id: string;
  url: string;
  disabled: boolean;
  /** Epoch millis, or null when the link never expires. */
  expiresAt: number | null;
};

export type CacheLookup =
  | { status: "hit"; link: CachedLink }
  | { status: "miss" }
  | { status: "unknown" };

/**
 * Looks up a slug.
 *   "hit"     — link found in cache
 *   "miss"    — cached as non-existent; skip Postgres entirely
 *   "unknown" — nothing cached (or Redis unavailable); caller must ask Postgres
 */
export async function getCachedLink(slug: string): Promise<CacheLookup> {
  const out = await redis([["GET", linkKey(slug)]]);
  const raw = out?.[0];

  if (typeof raw !== "string" || raw.length === 0) return { status: "unknown" };
  if (raw === MISS) return { status: "miss" };

  try {
    const parsed = JSON.parse(raw) as CachedLink;
    if (typeof parsed?.url !== "string" || typeof parsed?.id !== "string") {
      return { status: "unknown" };
    }
    return { status: "hit", link: parsed };
  } catch {
    return { status: "unknown" };
  }
}

/**
 * Caches a slug lookup. Pass null to remember that the slug doesn't exist.
 *
 * For links with an expiry we shorten the TTL so the cache can never outlive
 * the link itself and serve a redirect that should have stopped working.
 */
export async function cacheLink(slug: string, link: CachedLink | null): Promise<void> {
  if (!redisEnabled) return;

  if (!link) {
    await redis([["SET", linkKey(slug), MISS, "EX", MISS_TTL_SECONDS]]);
    return;
  }

  let ttl = HIT_TTL_SECONDS;
  if (link.expiresAt !== null) {
    const secondsLeft = Math.ceil((link.expiresAt - Date.now()) / 1000);
    // Already expired, but still worth caching briefly: old campaign links keep
    // attracting traffic long after they lapse, and without an entry here every
    // one of those hits would wake the database.
    ttl = secondsLeft <= 0 ? MISS_TTL_SECONDS : Math.min(ttl, secondsLeft);
  }

  await redis([["SET", linkKey(slug), JSON.stringify(link), "EX", ttl]]);
}

/**
 * Drops cached entries for the given slugs. Called from every mutation, which
 * is what makes the long TTL above safe.
 */
export async function invalidateLink(...slugs: (string | null | undefined)[]): Promise<void> {
  const keys = slugs.filter((s): s is string => Boolean(s)).map(linkKey);
  if (keys.length === 0 || !redisEnabled) return;
  await redis([["DEL", ...keys]]);
}

/** A buffered click. Keys are short to keep Redis memory and bandwidth low. */
export type QueuedClick = {
  /** linkId */ l: string;
  /** timestamp (epoch millis) */ t: number;
  /** referer */ r?: string;
  /** source */ s?: string;
  /** country */ c?: string;
  /** city */ y?: string;
  /** device */ d?: string;
};

/**
 * Buffers a click and bumps that link's pending counter, in one round-trip.
 * Returns false if Redis was unavailable, so the caller can decide whether to
 * fall back to writing straight to Postgres.
 */
export async function queueClick(click: QueuedClick): Promise<boolean> {
  const out = await redis([
    ["RPUSH", QUEUE_KEY, JSON.stringify(click)],
    ["INCR", pendingKey(click.l)],
  ]);
  return out !== null && out[0] !== null;
}

/**
 * Pending (buffered but not yet written) click counts, keyed by link id.
 * Lets the dashboard show live totals instead of stale post-flush numbers.
 */
export async function getPendingCounts(
  linkIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (linkIds.length === 0 || !redisEnabled) return counts;

  const out = await redis([["MGET", ...linkIds.map(pendingKey)]]);
  const values = out?.[0];
  if (!Array.isArray(values)) return counts;

  linkIds.forEach((id, i) => {
    const n = Number(values[i]);
    if (Number.isFinite(n) && n > 0) counts[id] = n;
  });
  return counts;
}

/** Reduces pending counters by the amounts just persisted to Postgres. */
export async function decrementPending(byLink: Map<string, number>): Promise<void> {
  if (byLink.size === 0 || !redisEnabled) return;
  await redis(
    [...byLink].map(([linkId, n]) => ["DECRBY", pendingKey(linkId), n]),
  );
}
