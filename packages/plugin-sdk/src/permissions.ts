import spec from "../spec/permissions.json";

/**
  * Permissions (plan §4.1 permissions.ts). Zero runtime dependencies
  * (pure JSON + string logic); the host frontend and the plugin template's
 * validation script (Node) can both import it directly.
 *
  * The single source of truth is spec/permissions.json in this package:
  * KNOWN_PERMISSIONS and the test vectors are all generated from / driven by it;
  * the Rust side consumes the same file via include_str!, so drift surfaces in
 * CI. Editing the spec = editing the security boundary.
 */

/** The full set of base permissions; `network:none` is kept for the
  "declares no network" semantics — a base permission, never a grant, and never
 * parsed into a grant that allows any host.
  * Besides these you may declare `network:`/`exec:` grants (below); unknown
 * permissions are rejected at install time. */
export const KNOWN_PERMISSIONS: Record<string, true> = Object.fromEntries(
  spec.knownPermissions.map((p) => [p, true]),
);

/** A `network:` grant body: `<host>` (any port) / `<host>:<port>` /
  *  `<host>:<a>-<b>` (port range, endpoints inclusive). The host matches
 *  exactly (case-insensitive, no wildcards or subdomains). */
const NETWORK_GRANT_RE = /^([A-Za-z0-9.-]+)(?::(\d+)(?:-(\d+))?)?$/;

/** The binary name of an `exec:` grant: a bare name, no path separators. */
const EXEC_BIN_RE = /^[A-Za-z0-9._-]+$/;

interface NetworkGrant {
  host: string;
  /** null = any port. */
  portFrom: number | null;
  portTo: number | null;
}

/** Parse a `network:` grant body; returns null when the shape is invalid
  *  (empty host / non-numeric port / inverted or out-of-range interval).
  *  `none` is an explicit denial: `network:none` is a base permission, not a
 *  grant, and the Rust side likewise never parses it into one (see the spec's
 *  networkAllow vectors). */
function parseNetworkGrant(spec: string): NetworkGrant | null {
  const m = NETWORK_GRANT_RE.exec(spec);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (host === "none") return null;
  if (m[2] === undefined) return { host, portFrom: null, portTo: null };
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (from < 1 || to > 65535 || from > to) return null;
  return { host, portFrom: from, portTo: to };
}

/** Whether a manifest permissions element is known: a base permission from the
  * spec, or a well-formed `network:`/`exec:` grant. The host permissions.ts, the
  * template's validate-manifest.mjs, and Rust plugins.rs all run the same set
 * of vectors from spec/permissions.json. */
export function isKnownPermission(p: string): boolean {
  if (KNOWN_PERMISSIONS[p]) return true;
  if (p.startsWith("network:")) return parseNetworkGrant(p.slice("network:".length)) !== null;
  if (p.startsWith("exec:")) return EXEC_BIN_RE.test(p.slice("exec:".length));
  return false;
}

/** Whether the url matches any `network:` grant in grants. http/https only; the
  *  host must match exactly (case-insensitive; subdomains do not match); when
  *  the grant carries a port or range the url's port (defaulting to 80/443 by
 *  protocol) must fall inside it. */
export function networkGrantAllows(grants: readonly string[], url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  for (const g of grants) {
    if (!g.startsWith("network:")) continue;
    const grant = parseNetworkGrant(g.slice("network:".length));
    if (!grant || grant.host !== host) continue;
    if (grant.portFrom === null) return true;
    if (port >= grant.portFrom && port <= (grant.portTo as number)) return true;
  }
  return false;
}

/** Whether bin matches an `exec:<bin>` grant (exact match; bin must be a
 *  valid bare name). */
export function execGrantAllows(grants: readonly string[], bin: string): boolean {
  return EXEC_BIN_RE.test(bin) && grants.includes(`exec:${bin}`);
}
