/**
 * Who may do what with a link — the rules only, with no database access.
 *
 * Kept apart from link-access.ts so client components can import it without
 * pulling Prisma into the browser bundle, and so the rules can be tested on
 * their own.
 */

export type LinkAccess = "none" | "view" | "edit" | "owner";

export type LinkCapabilities = {
  access: LinkAccess;
  /** See the link and its statistics, and export them. */
  canView: boolean;
  /** Change destination, title, slug and expiry. */
  canEdit: boolean;
  /** Toggle the link between active and disabled. */
  canDisable: boolean;
  /**
   * Delete the link. Owner and admins only: deleting destroys the click
   * history and breaks a link that is already out in the world.
   */
  canDelete: boolean;
  /** Grant or revoke another person's access. Owner and admins only. */
  canShare: boolean;
};

export function capabilitiesFor(access: LinkAccess): LinkCapabilities {
  return {
    access,
    canView: access !== "none",
    canEdit: access === "owner" || access === "edit",
    canDisable: access === "owner" || access === "edit",
    canDelete: access === "owner",
    canShare: access === "owner",
  };
}
