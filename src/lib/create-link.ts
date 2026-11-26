import { prisma } from "@/lib/prisma";
import { buildDestinationUrl, type CustomParam, type UtmParams } from "@/lib/url";
import { randomSlug, validateCustomSlug, RESERVED_SLUGS } from "@/lib/slug";
import { invalidateLink } from "@/lib/link-cache";

/**
 * Creating a link, with no idea who asked.
 *
 * This used to live inside the `createLink` server action, which made it
 * reachable only by a signed-in person with a FormData in hand. The API route
 * needs the same URL validation, UTM building, slug generation and
 * taken-slug handling, so the rules live here and both callers go through
 * them — the alternative being two copies that drift apart.
 */

export type NewLink = {
  /** Whose link this is. A person for the form, the service user for the API. */
  ownerId: string;
  url: string;
  title?: string | null;
  /** A requested custom slug. Empty or absent means "generate one". */
  slug?: string | null;
  clientId?: string | null;
  expiresAt?: Date | null;
  utm?: UtmParams;
  custom?: CustomParam[];
};

export type NewLinkResult =
  | { ok: true; id: string; slug: string }
  /** `reason` lets the API route pick a status code; the form just shows `error`. */
  | { ok: false; error: string; reason: "invalid" | "taken" | "failed" };

export async function createLinkRecord(input: NewLink): Promise<NewLinkResult> {
  let destination: string;
  try {
    destination = buildDestinationUrl(input.url, input.utm ?? {}, input.custom ?? []);
  } catch (e) {
    return { ok: false, error: (e as Error).message, reason: "invalid" };
  }

  const requested = (input.slug ?? "").trim();
  if (requested) {
    const err = validateCustomSlug(requested);
    if (err) return { ok: false, error: err, reason: "invalid" };
  }

  // Resolving the slug reads the database, and so can fail for reasons that
  // have nothing to do with the request. The API route turns `failed` into a
  // 500 with a JSON body; letting the error escape instead would hand the
  // calling system a bodiless 500 it cannot tell apart from a crash.
  let slug: string;
  try {
    if (requested) {
      const existing = await prisma.link.findUnique({ where: { slug: requested } });
      if (existing) {
        return { ok: false, error: "הכתובת המותאמת כבר תפוסה", reason: "taken" };
      }
      slug = requested;
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
  } catch {
    return { ok: false, error: "שמירת הלינק נכשלה, נסו שוב", reason: "failed" };
  }

  let created: { id: string; slug: string };
  try {
    created = await prisma.link.create({
      data: {
        slug,
        url: destination,
        title: input.title?.trim() || null,
        clientId: input.clientId ?? null,
        ownerId: input.ownerId,
        expiresAt: input.expiresAt ?? null,
      },
      select: { id: true, slug: true },
    });
  } catch {
    return { ok: false, error: "שמירת הלינק נכשלה, נסו שוב", reason: "failed" };
  }

  // A request for this slug may have been negative-cached before it existed.
  await invalidateLink(created.slug);
  return { ok: true, id: created.id, slug: created.slug };
}
