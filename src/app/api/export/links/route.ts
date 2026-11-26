import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/base-url";
import { toCsv, csvResponse } from "@/lib/csv";
import { existingServiceUserId } from "@/lib/service-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const baseUrl = await getBaseUrl();

  // Same reach as the dashboard: admins also get the API service account's
  // links, which otherwise belong to nobody's export.
  const serviceId =
    session.user.role === "ADMIN" ? await existingServiceUserId() : null;

  const links = await prisma.link.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { shares: { some: { userId: session.user.id } } },
        ...(serviceId ? [{ ownerId: serviceId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clicks: true } } },
  });

  const header = [
    "slug",
    "short_url",
    "destination",
    "title",
    "client_id",
    "clicks",
    "created_at",
    "expires_at",
  ];
  const rows = links.map((l) => [
    l.slug,
    `${baseUrl}/${l.slug}`,
    l.url,
    l.title ?? "",
    l.clientId ?? "",
    l._count.clicks,
    l.createdAt.toISOString(),
    l.expiresAt ? l.expiresAt.toISOString() : "",
  ]);

  return csvResponse(toCsv(header, rows), "katz-links.csv");
}
