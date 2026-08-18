/**
 * Minimal Upstash Redis client over the REST API.
 *
 * Deliberately dependency-free: the redirect path is the hottest code in the
 * app, and every command here has to survive Redis being slow, unreachable or
 * simply not configured. Nothing in this module throws — callers get null and
 * fall back to Postgres.
 */

// Vercel's Upstash integration injects KV_*; a hand-made Upstash DB injects
// UPSTASH_*. Accept either so the app works however the store was provisioned.
const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

/** True when a Redis store is wired up. When false the app still works. */
export const redisEnabled = Boolean(REST_URL && REST_TOKEN);

type Command = (string | number)[];

/** How long we wait on Redis before giving up and using Postgres instead. */
const TIMEOUT_MS = 1_500;

/**
 * Runs one or more commands in a single round-trip.
 * Returns one entry per command, or null if the whole call failed.
 */
export async function redis(commands: Command[]): Promise<(unknown | null)[] | null> {
  if (!redisEnabled || commands.length === 0) return null;

  try {
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      // Never let Next's data cache memoize a Redis read.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as
      | { result?: unknown; error?: string }[]
      | { error: string };

    if (!Array.isArray(body)) return null;
    return body.map((entry) => (entry.error ? null : (entry.result ?? null)));
  } catch {
    // Timeout, DNS failure, malformed JSON — all handled the same way.
    return null;
  }
}

/** Convenience wrapper for a single command. */
export async function redisOne(command: Command): Promise<unknown | null> {
  const out = await redis([command]);
  return out ? out[0] : null;
}
