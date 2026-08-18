/**
 * Drains buffered clicks from Redis into Postgres.
 *
 * Runs from two places: the daily Vercel cron, and (via `after`) whenever
 * someone loads the dashboard. The dashboard case is essentially free — that
 * request already woke the database — which keeps the analytics fresh without
 * costing extra compute time.
 */

import { prisma } from "@/lib/prisma";
import { redis, redisEnabled } from "@/lib/redis";
import { QUEUE_KEY, decrementPending, type QueuedClick } from "@/lib/link-cache";

/** Rows pulled from Redis per round-trip. */
const BATCH_SIZE = 500;

export type FlushResult = {
  /** Rows written to Postgres. */
  written: number;
  /** Rows dropped because their link no longer exists. */
  orphaned: number;
  /** True if the queue still had items when we stopped. */
  truncated: boolean;
};

/**
 * @param maxBatches Caps the work per invocation so we stay inside the
 *   function timeout. The cron passes a high number; the dashboard a low one.
 */
export async function flushClicks(maxBatches = 4): Promise<FlushResult> {
  const result: FlushResult = { written: 0, orphaned: 0, truncated: false };
  if (!redisEnabled) return result;

  // Clicks whose link was deleted between the redirect and now would fail the
  // whole insert on a foreign-key violation, so resolve valid ids up front.
  // The link table is tiny, unlike the click table.
  let liveLinkIds: Set<string>;
  try {
    const links = await prisma.link.findMany({ select: { id: true } });
    liveLinkIds = new Set(links.map((l) => l.id));
  } catch {
    return result;
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const popped = await redis([["LPOP", QUEUE_KEY, BATCH_SIZE]]);
    const raw = popped?.[0];

    // null/empty means the queue is drained.
    if (!Array.isArray(raw) || raw.length === 0) return result;

    const rows: {
      linkId: string;
      createdAt: Date;
      referer: string | null;
      source: string | null;
      country: string | null;
      city: string | null;
      device: string | null;
    }[] = [];
    const pending = new Map<string, number>();
    let orphanedInBatch = 0;

    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      let click: QueuedClick;
      try {
        click = JSON.parse(entry) as QueuedClick;
      } catch {
        continue;
      }
      if (!click?.l) continue;

      // Count against the pending total either way, so a deleted link's
      // counter doesn't stay stuck above zero forever.
      pending.set(click.l, (pending.get(click.l) ?? 0) + 1);

      if (!liveLinkIds.has(click.l)) {
        orphanedInBatch++;
        continue;
      }

      rows.push({
        linkId: click.l,
        createdAt: new Date(click.t),
        referer: click.r ?? null,
        source: click.s ?? null,
        country: click.c ?? null,
        city: click.y ?? null,
        device: click.d ?? null,
      });
    }

    if (rows.length > 0) {
      try {
        await prisma.click.createMany({ data: rows });
      } catch {
        // Put them back rather than lose them. Order doesn't matter: every row
        // carries its own createdAt, so the queue is not chronological state.
        await redis([["RPUSH", QUEUE_KEY, ...raw.filter((e): e is string => typeof e === "string")]]);
        result.truncated = true;
        return result;
      }
    }

    result.written += rows.length;
    result.orphaned += orphanedInBatch;
    await decrementPending(pending);

    // A short batch means we reached the end of the queue.
    if (raw.length < BATCH_SIZE) return result;
  }

  // Ran out of batches with items still queued.
  result.truncated = true;
  return result;
}
