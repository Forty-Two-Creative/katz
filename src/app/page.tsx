import { after } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPendingCounts } from "@/lib/link-cache";
import { accessFromRow, capabilitiesFor } from "@/lib/link-access";
import { existingServiceUserId, SERVICE_USER_EMAIL } from "@/lib/service-user";
import { flushClicks } from "@/lib/clicks-flush";
import { getBaseUrl } from "@/lib/base-url";
import { Header } from "@/components/Header";
import { LoginScreen } from "@/components/LoginScreen";
import { CreateLinkForm } from "@/components/CreateLinkForm";
import { type LinkCardData } from "@/components/LinkCard";
import { LinksBrowser } from "@/components/LinksBrowser";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ notfound?: string; expired?: string; disabled?: string }>;
}) {
  const session = await auth();
  const { notfound, expired, disabled } = await searchParams;

  if (!session?.user?.id) {
    return <LoginScreen />;
  }

  const baseUrl = await getBaseUrl();

  // Links created through the API belong to the service account, so they are
  // in nobody's personal list. Admins already have full reach over every link
  // (see accessFor), so surface them here rather than nowhere.
  const serviceId =
    session.user.role === "ADMIN" ? await existingServiceUserId() : null;

  // Links the viewer owns, plus any a colleague has shared with them.
  const links = await prisma.link.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { shares: { some: { userId: session.user.id } } },
        ...(serviceId ? [{ ownerId: serviceId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { clicks: true } },
      owner: { select: { name: true, email: true } },
      shares: {
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  // Everyone who could be shared with. Small, single-domain organisation, so a
  // picker beats typing an address and getting it wrong.
  const people = await prisma.user.findMany({
    where: {
      id: { not: session.user.id },
      // The API service account is not a colleague you can share a link with.
      email: { not: SERVICE_USER_EMAIL },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  // Clicks sitting in the Redis buffer haven't reached Postgres yet, so add
  // them in — otherwise the totals would lag behind reality by up to a day.
  const pending = await getPendingCounts(links.map((l) => l.id));

  // This request already woke the database, which makes draining the queue
  // essentially free. Runs once the response has been sent.
  after(() => flushClicks(6));

  const cards: LinkCardData[] = links.map((l) => {
    const perms = capabilitiesFor(
      accessFromRow(l, session.user.id!, session.user.role),
    );
    return {
      id: l.id,
      slug: l.slug,
      title: l.title,
      url: l.url,
      clientId: l.clientId,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      disabled: l.disabled,
      clicks: l._count.clicks + (pending[l.id] ?? 0),
      // Only label the owner on links that aren't the viewer's own.
      ownerName:
        l.ownerId === session.user.id
          ? null
          : (l.owner.name ?? l.owner.email),
      perms,
      // Don't reveal the full access list to someone who can't change it.
      shares: perms.canShare
        ? l.shares.map((sh) => ({
            id: sh.user.id,
            name: sh.user.name,
            email: sh.user.email,
            role: sh.role,
          }))
        : undefined,
    };
  });

  return (
    <>
      <Header user={session.user} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">קצרו לינק חדש</h1>
          <p className="mt-1 text-gray-500">
            הדביקו לינק ארוך, ותקבלו לינק קצר לשיתוף — עם מעקב כניסות.
          </p>
        </div>

        {notfound && (
          <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            הלינק <span dir="ltr" className="font-mono">/{notfound}</span> לא קיים או נמחק.
          </div>
        )}

        {expired && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            הלינק <span dir="ltr" className="font-mono">/{expired}</span> פג תוקף.
          </div>
        )}

        {disabled && (
          <div className="mb-4 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600 ring-1 ring-gray-200">
            הלינק <span dir="ltr" className="font-mono">/{disabled}</span> מושבת כרגע.
          </div>
        )}

        <CreateLinkForm baseUrl={baseUrl} />

        <LinksBrowser cards={cards} baseUrl={baseUrl} people={people} />
      </main>
    </>
  );
}
