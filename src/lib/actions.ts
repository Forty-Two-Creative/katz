"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildDestinationUrl, type CustomParam } from "@/lib/url";
import { randomSlug, validateCustomSlug, RESERVED_SLUGS } from "@/lib/slug";
import { invalidateLink } from "@/lib/link-cache";
import { accessFor, capabilitiesFor } from "@/lib/link-access";

export type CreateLinkState = {
  ok: boolean;
  error?: string;
  slug?: string;
};

/** Parses an optional expiry timestamp (ISO string) from the form. */
function parseExpiry(formData: FormData): Date | null {
  const raw = String(formData.get("expiresAt") ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Reads repeated customKey[]/customValue[] inputs into a list of params. */
function readCustomParams(formData: FormData): CustomParam[] {
  const keys = formData.getAll("customKey").map((v) => String(v));
  const values = formData.getAll("customValue").map((v) => String(v));
  const out: CustomParam[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]?.trim();
    const value = values[i]?.trim();
    if (key && value) out.push({ key, value });
  }
  return out;
}

export async function createLink(
  _prev: CreateLinkState,
  formData: FormData,
): Promise<CreateLinkState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "צריך להתחבר כדי לקצר לינק" };
  }

  const rawUrl = String(formData.get("url") ?? "");
  const title = String(formData.get("title") ?? "").trim() || null;
  const customSlugRaw = String(formData.get("slug") ?? "").trim();

  let destination: string;
  try {
    destination = buildDestinationUrl(
      rawUrl,
      {
        source: String(formData.get("utm_source") ?? ""),
        medium: String(formData.get("utm_medium") ?? ""),
        campaign: String(formData.get("utm_campaign") ?? ""),
        term: String(formData.get("utm_term") ?? ""),
        content: String(formData.get("utm_content") ?? ""),
      },
      readCustomParams(formData),
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  let slug: string;
  if (customSlugRaw) {
    const err = validateCustomSlug(customSlugRaw);
    if (err) return { ok: false, error: err };
    const existing = await prisma.link.findUnique({
      where: { slug: customSlugRaw },
    });
    if (existing) return { ok: false, error: "הכתובת המותאמת כבר תפוסה" };
    slug = customSlugRaw;
  } else {
    // Generate a unique random slug.
    slug = randomSlug();
    for (let i = 0; i < 5; i++) {
      const taken =
        RESERVED_SLUGS.has(slug) ||
        (await prisma.link.findUnique({ where: { slug } }));
      if (!taken) break;
      slug = randomSlug();
    }
  }

  try {
    await prisma.link.create({
      data: {
        slug,
        url: destination,
        title,
        ownerId: session.user.id,
        expiresAt: parseExpiry(formData),
      },
    });
  } catch {
    return { ok: false, error: "שמירת הלינק נכשלה, נסו שוב" };
  }

  // A request for this slug may have been negative-cached before it existed.
  await invalidateLink(slug);
  revalidatePath("/");
  return { ok: true, slug };
}

export async function deleteLink(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const link = await prisma.link.findUnique({ where: { id } });
  if (!link) return;

  const can = capabilitiesFor(
    await accessFor(link, session.user.id, session.user.role),
  );
  if (!can.canDelete) return;

  await prisma.link.delete({ where: { id } });
  await invalidateLink(link.slug);
  revalidatePath("/");
}

/** Toggles a link between active and temporarily disabled. */
export async function toggleLinkActive(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const link = await prisma.link.findUnique({ where: { id } });
  if (!link) return;

  const can = capabilitiesFor(
    await accessFor(link, session.user.id, session.user.role),
  );
  if (!can.canDisable) return;

  await prisma.link.update({
    where: { id },
    data: { disabled: !link.disabled },
  });
  await invalidateLink(link.slug);
  revalidatePath("/");
  revalidatePath(`/link/${id}`);
}

export type UpdateLinkState = { ok: boolean; error?: string };

export async function updateLink(
  _prev: UpdateLinkState,
  formData: FormData,
): Promise<UpdateLinkState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "צריך להתחבר" };

  const id = String(formData.get("id") ?? "");
  const link = await prisma.link.findUnique({ where: { id } });
  if (!link) return { ok: false, error: "הלינק לא נמצא" };

  const can = capabilitiesFor(
    await accessFor(link, session.user.id, session.user.role),
  );
  if (!can.canEdit) return { ok: false, error: "אין הרשאה" };

  const title = String(formData.get("title") ?? "").trim() || null;
  const rawUrl = String(formData.get("url") ?? "");
  const newSlug = String(formData.get("slug") ?? "").trim();

  // Validate + normalize the destination URL.
  let destination: string;
  try {
    destination = buildDestinationUrl(rawUrl, {});
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Validate the slug if it changed.
  if (newSlug !== link.slug) {
    const err = validateCustomSlug(newSlug);
    if (err) return { ok: false, error: err };
    const taken = await prisma.link.findUnique({ where: { slug: newSlug } });
    if (taken) return { ok: false, error: "הכתובת המותאמת כבר תפוסה" };
  }

  await prisma.link.update({
    where: { id },
    data: { title, url: destination, slug: newSlug, expiresAt: parseExpiry(formData) },
  });

  // Both slugs: the old one must stop resolving, the new one may be stale.
  await invalidateLink(link.slug, newSlug);

  revalidatePath("/");
  revalidatePath(`/link/${id}`);
  return { ok: true };
}

// ===== Per-link sharing =====

/** Loads the link and checks the caller may change who it is shared with. */
async function guardShare(linkId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return null;
  const can = capabilitiesFor(
    await accessFor(link, session.user.id, session.user.role),
  );
  if (!can.canShare) return null;
  return { session, link };
}

export type ShareState = { ok: boolean; error?: string };

/** Grants a colleague access to a link, or changes the level they already have. */
export async function shareLink(
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  const linkId = String(formData.get("linkId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "VIEWER");

  if (!userId) return { ok: false, error: "בחרו עם מי לשתף" };
  if (role !== "VIEWER" && role !== "EDITOR") {
    return { ok: false, error: "הרשאה לא מוכרת" };
  }

  const guard = await guardShare(linkId);
  if (!guard) return { ok: false, error: "אין הרשאה לשתף את הלינק הזה" };

  // Sharing with the owner would be a no-op that then shows up as a
  // revocable row, which is confusing.
  if (userId === guard.link.ownerId) {
    return { ok: false, error: "הלינק כבר שייך למשתמש הזה" };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "המשתמש לא נמצא" };

  await prisma.linkShare.upsert({
    where: { linkId_userId: { linkId, userId } },
    create: { linkId, userId, role, sharedById: guard.session.user.id },
    update: { role },
  });

  revalidatePath("/");
  revalidatePath(`/link/${linkId}`);
  return { ok: true };
}

/** Revokes a colleague's access. */
export async function unshareLink(formData: FormData): Promise<void> {
  const linkId = String(formData.get("linkId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!linkId || !userId) return;

  const guard = await guardShare(linkId);
  if (!guard) return;

  await prisma.linkShare
    .delete({ where: { linkId_userId: { linkId, userId } } })
    .catch(() => {});

  revalidatePath("/");
  revalidatePath(`/link/${linkId}`);
}

// ===== Admin: user management =====

export async function setUserRole(formData: FormData): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || (role !== "USER" && role !== "ADMIN")) return;

  // Don't allow demoting the hard-coded super admin.
  const target = await prisma.user.findUnique({ where: { id: userId } });
  const superAdmin = (
    process.env.SUPER_ADMIN_EMAIL ?? "or@42creative.co.il"
  ).toLowerCase();
  if (target?.email?.toLowerCase() === superAdmin && role !== "ADMIN") return;

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin");
}

export async function deleteUser(formData: FormData): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;

  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === session.user.id) return;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  const superAdmin = (
    process.env.SUPER_ADMIN_EMAIL ?? "or@42creative.co.il"
  ).toLowerCase();
  if (target?.email?.toLowerCase() === superAdmin) return;

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin");
}
