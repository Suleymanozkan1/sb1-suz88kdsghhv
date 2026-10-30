/**
 * Writes that only take access away: deactivating a user or resetting their password (both end the user's sessions
 * and API tokens), revoking an invitation, an automation key or one's own API tokens. A company whose subscription
 * expired (read-only) or whose package no longer includes the module must still be able to lock out a leaver or a
 * leaked key, so the API wrapper lets exactly these through (src/server/http/handler.ts). Method and full path are
 * matched, never a prefix: nothing here creates or grants access.
 */

type Body = Record<string, unknown>;

interface AccessRemoval {
  method: string;
  path: RegExp;
  /** for an edit route: the access-reducing part of the body, or null when it reduces nothing */
  narrow?: (body: Body) => Body | null;
}

const ID = "[^/]+";

/** A user edit counts only for deactivation and password reset; any other change in the same request is not applied. */
function userAccessRemoval(b: Body): Body | null {
  const out: Body = {};
  if (b.active === false) out.active = false;
  if (typeof b.password === "string" && b.password) out.password = b.password;
  return Object.keys(out).length ? out : null;
}

export const ACCESS_REMOVALS: AccessRemoval[] = [
  { method: "PATCH", path: new RegExp(`^/api/admin/users/${ID}$`), narrow: userAccessRemoval },
  { method: "POST", path: new RegExp(`^/api/admin/invites/${ID}/revoke$`) },
  { method: "DELETE", path: new RegExp(`^/api/integrations/keys/${ID}$`) },
  { method: "DELETE", path: /^\/api\/auth\/api-token$/ },
];

/**
 * Whether this request only removes access. `readBody` is called only for edit routes; the result is the body the
 * handler may run with (narrowed to the access-reducing fields), or null when the request is not an access removal.
 */
export async function accessRemoval(method: string, path: string, readBody: () => Promise<unknown>): Promise<{ body: (() => Promise<unknown>) } | null> {
  const r = ACCESS_REMOVALS.find((x) => x.method === method && x.path.test(path));
  if (!r) return null;
  if (!r.narrow) return { body: readBody };
  const raw = await readBody();
  const narrowed = raw && typeof raw === "object" && !Array.isArray(raw) ? r.narrow(raw as Body) : null;
  return narrowed ? { body: async () => narrowed } : null;
}
