"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteLink, toggleLinkActive } from "@/lib/actions";
import { CopyButton, ShareButton } from "@/components/ShortLinkActions";
import { QrButton } from "@/components/QrButton";
import {
  SharePanel,
  type ShareEntry,
  type SharePerson,
} from "@/components/SharePanel";
import { type LinkCapabilities } from "@/lib/link-roles";

export type LinkCardData = {
  id: string;
  slug: string;
  title: string | null;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  disabled: boolean;
  clicks: number;
  ownerName?: string | null;
  /** Resolved on the server so the client never needs the access rules. */
  perms: LinkCapabilities;
  /** Who this link is already shared with. Only sent when the viewer may share. */
  shares?: ShareEntry[];
};

export function LinkCard({
  link,
  baseUrl,
  people = [],
}: {
  link: LinkCardData;
  baseUrl: string;
  /** Colleagues who could be added, passed down once for the whole list. */
  people?: SharePerson[];
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const shortUrl = `${baseUrl}/${link.slug}`;
  const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null;
  const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;

  return (
    <div
      className={`rounded-2xl p-4 shadow-sm ring-1 transition hover:shadow-md sm:p-5 ${
        link.disabled
          ? "bg-gray-50 ring-gray-200"
          : "bg-white ring-gray-100"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {link.title && (
            <p className="mb-0.5 truncate font-semibold text-gray-900">
              {link.title}
            </p>
          )}
          <a
            href={shortUrl}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className={`block truncate text-base font-semibold hover:underline ${
              link.disabled
                ? "text-gray-400 line-through"
                : "text-brand-700"
            }`}
          >
            {shortUrl.replace(/^https?:\/\//, "")}
          </a>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="mt-0.5 block truncate text-xs text-gray-400 hover:text-gray-600"
          >
            {link.url}
          </a>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <CopyButton value={shortUrl} />
          {link.perms.canShare ? (
            <button
              type="button"
              onClick={() => setShareOpen((v) => !v)}
              aria-expanded={shareOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
                shareOpen
                  ? "bg-brand-50 text-brand-700 ring-brand-200"
                  : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              שיתוף
              {(link.shares?.length ?? 0) > 0 && (
                <span className="rounded bg-brand-100 px-1 text-xs font-bold text-brand-700">
                  {link.shares!.length}
                </span>
              )}
            </button>
          ) : (
            <ShareButton url={shortUrl} title={link.title ?? undefined} />
          )}
          <QrButton url={shortUrl} slug={link.slug} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-sm">
        <div className="flex items-center gap-4 text-gray-500">
          <span className="inline-flex items-center gap-1 font-medium text-gray-700">
            <span className="text-brand-600">{link.clicks}</span> כניסות
          </span>
          <span className="text-gray-400">
            {new Date(link.createdAt).toLocaleDateString("he-IL")}
          </span>
          {link.ownerName && (
            <span className="text-gray-400">· {link.ownerName}</span>
          )}
          {link.perms.access === "view" && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              שותף איתך · צפייה
            </span>
          )}
          {link.perms.access === "edit" && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              שותף איתך · עריכה
            </span>
          )}
          {link.disabled && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
              מושבת
            </span>
          )}
          {expiresAt &&
            (isExpired ? (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                פג תוקף
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                תקף עד {expiresAt.toLocaleDateString("he-IL")}
              </span>
            ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/link/${link.id}`}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            סטטיסטיקות
          </Link>
          {link.perms.canEdit && (
            <Link
              href={`/link/${link.id}/edit`}
              className="font-medium text-gray-500 hover:text-gray-800"
            >
              ערוך
            </Link>
          )}
          {link.perms.canDisable && (
          <form action={toggleLinkActive}>
            <input type="hidden" name="id" value={link.id} />
            <button
              type="submit"
              className={`font-medium ${
                link.disabled
                  ? "text-green-600 hover:text-green-700"
                  : "text-gray-500 hover:text-amber-600"
              }`}
            >
              {link.disabled ? "הפעל" : "השבת"}
            </button>
          </form>
          )}
          {link.perms.canDelete && (
          <form
            action={deleteLink}
            onSubmit={(e) => {
              if (!confirm("למחוק את הלינק? פעולה זו אינה הפיכה.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={link.id} />
            <button
              type="submit"
              className="font-medium text-gray-400 transition hover:text-red-600"
            >
              מחק
            </button>
          </form>
          )}
        </div>
      </div>

      {shareOpen && link.perms.canShare && (
        <SharePanel
          linkId={link.id}
          shortUrl={shortUrl}
          title={link.title ?? undefined}
          shares={link.shares ?? []}
          people={people}
        />
      )}
    </div>
  );
}
