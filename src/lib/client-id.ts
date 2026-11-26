/**
 * The client a link belongs to, carried as Tiki's `Client.id` — the cuid that
 * is the shared identifier across 42's systems.
 *
 * It is stored opaquely: Katz has no client table and never resolves the id to
 * a name. The check below only keeps obvious junk (spaces, a pasted client
 * name, a whole URL) out of the column, so a value that reaches the database
 * can safely be echoed into a CSV or matched against Tiki.
 */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const CLIENT_ID_ERROR =
  "מזהה לקוח לא תקין — אותיות באנגלית, ספרות, מקף וקו תחתון בלבד, עד 64 תווים";

export type ClientIdResult = { value: string | null } | { error: string };

/** Trims an incoming client id. Empty means "not set", which is allowed. */
export function normalizeClientId(raw: unknown): ClientIdResult {
  const value = String(raw ?? "").trim();
  if (!value) return { value: null };
  if (!CLIENT_ID_RE.test(value)) return { error: CLIENT_ID_ERROR };
  return { value };
}
