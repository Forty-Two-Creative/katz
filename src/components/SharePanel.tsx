"use client";

import { useActionState, useRef } from "react";
import { shareLink, unshareLink, type ShareState } from "@/lib/actions";
import { ShareButton } from "@/components/ShortLinkActions";

export type SharePerson = {
  id: string;
  name: string | null;
  email: string | null;
};

export type ShareEntry = SharePerson & { role: "VIEWER" | "EDITOR" };

const ROLE_LABEL: Record<"VIEWER" | "EDITOR", string> = {
  VIEWER: "צפייה בלבד",
  EDITOR: "עריכה",
};

function initial(person: SharePerson): string {
  return (person.name ?? person.email ?? "?").charAt(0).toUpperCase();
}

export function SharePanel({
  linkId,
  shortUrl,
  title,
  shares,
  people,
}: {
  linkId: string;
  shortUrl: string;
  title?: string;
  shares: ShareEntry[];
  /** Everyone in the organisation who could still be added. */
  people: SharePerson[];
}) {
  const [state, formAction, pending] = useActionState<ShareState, FormData>(
    shareLink,
    { ok: true },
  );
  const addForm = useRef<HTMLFormElement>(null);

  const shared = new Set(shares.map((s) => s.id));
  const candidates = people.filter((p) => !shared.has(p.id));

  return (
    <div className="mt-4 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200">
      <h4 className="mb-3 text-sm font-bold text-gray-900">
        שיתוף עם הצוות
      </h4>

      {shares.length > 0 && (
        <ul className="mb-4 space-y-2">
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-gray-100"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {initial(s)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {s.name ?? "—"}
                  </p>
                  <p dir="ltr" className="truncate text-xs text-gray-400">
                    {s.email}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Changing the level re-uses the same action, which upserts. */}
                <form action={formAction}>
                  <input type="hidden" name="linkId" value={linkId} />
                  <input type="hidden" name="userId" value={s.id} />
                  <select
                    name="role"
                    defaultValue={s.role}
                    aria-label={`הרשאה עבור ${s.name ?? s.email}`}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="rounded-lg border-gray-200 bg-white py-1 pe-7 ps-2 text-xs text-gray-700 ring-1 ring-gray-200"
                  >
                    <option value="VIEWER">{ROLE_LABEL.VIEWER}</option>
                    <option value="EDITOR">{ROLE_LABEL.EDITOR}</option>
                  </select>
                </form>
                <form action={unshareLink}>
                  <input type="hidden" name="linkId" value={linkId} />
                  <input type="hidden" name="userId" value={s.id} />
                  <button
                    type="submit"
                    className="text-xs font-medium text-gray-400 transition hover:text-red-600"
                  >
                    הסר
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 ? (
        <form
          ref={addForm}
          action={formAction}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="linkId" value={linkId} />
          <select
            name="userId"
            defaultValue=""
            required
            aria-label="בחרו עם מי לשתף"
            className="min-w-40 flex-1 rounded-lg border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 ring-1 ring-gray-200"
          >
            <option value="" disabled>
              בחרו אדם…
            </option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
          <select
            name="role"
            defaultValue="VIEWER"
            aria-label="רמת הרשאה"
            className="rounded-lg border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 ring-1 ring-gray-200"
          >
            <option value="VIEWER">{ROLE_LABEL.VIEWER}</option>
            <option value="EDITOR">{ROLE_LABEL.EDITOR}</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? "משתף…" : "שתף"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-400">
          {shares.length > 0
            ? "כל חברי הצוות כבר משותפים בלינק הזה."
            : "אין עוד משתמשים בארגון לשתף איתם."}
        </p>
      )}

      {state.error && (
        <p className="mt-2 text-sm text-red-600">{state.error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
        <span className="text-xs text-gray-500">
          לשליחת הלינק עצמו למי שרק צריך להיכנס אליו:
        </span>
        <ShareButton url={shortUrl} title={title} />
      </div>
    </div>
  );
}
