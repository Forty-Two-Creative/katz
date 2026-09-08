/**
 * Who may do what with a link.
 *
 * The same six checks used to be spelled out at each call site as
 * `isOwner || isAdmin`. Per-link sharing adds two more levels, so the rules
 * live here instead of being restated (and drifting) in every page and action.
 */

import { prisma } from "@/lib/prisma";

export {
  capabilitiesFor,
  type LinkAccess,
  type LinkCapabilities,
} from "@/lib/link-roles";

import { capabilitiesFor, type LinkAccess } from "@/lib/link-roles";

/** Resolves access for a link whose owner is already known. */
export async function accessFor(
  link: { id: string; ownerId: string },
  userId: string | undefined,
  userRole: string | undefined,
): Promise<LinkAccess> {
  if (!userId) return "none";
  if (link.ownerId === userId) return "owner";
  // Admins already had full reach over every link before sharing existed.
  if (userRole === "ADMIN") return "owner";

  const share = await prisma.linkShare.findUnique({
    where: { linkId_userId: { linkId: link.id, userId } },
    select: { role: true },
  });
  if (!share) return "none";
  return share.role === "EDITOR" ? "edit" : "view";
}

/** Same, but loads the link. Returns null when the link doesn't exist. */
export async function loadLinkWithAccess(
  linkId: string,
  userId: string | undefined,
  userRole: string | undefined,
) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return null;
  const access = await accessFor(link, userId, userRole);
  return { link, ...capabilitiesFor(access) };
}

/**
 * Turns a dashboard row into capabilities without another query, using the
 * viewer's own share row that the list query already fetched.
 */
export function accessFromRow(
  row: { ownerId: string; shares: { role: string }[] },
  userId: string,
  userRole: string | undefined,
): LinkAccess {
  if (row.ownerId === userId) return "owner";
  if (userRole === "ADMIN") return "owner";
  const role = row.shares[0]?.role;
  if (!role) return "none";
  return role === "EDITOR" ? "edit" : "view";
}
