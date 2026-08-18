import { flushClicks } from "@/lib/clicks-flush";

export const dynamic = "force-dynamic";
// The queue can hold a full day of clicks, so give the flush room to finish.
export const maxDuration = 60;

/**
 * Writes buffered clicks to Postgres.
 *
 * Vercel's scheduler calls this with `Authorization: Bearer $CRON_SECRET`.
 * Without a secret configured the endpoint refuses to run in production —
 * otherwise anyone could hammer it and wake the database at will, which is the
 * exact cost this whole mechanism exists to avoid.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
    }
  } else if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Generous batch budget: this is the one scheduled chance to drain the queue.
  const result = await flushClicks(40);
  return Response.json({ ok: true, ...result });
}
