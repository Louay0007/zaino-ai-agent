/**
 * The version handshake (manifest sdkVersion range). Zero dependencies, so Node
 * scripts can import it directly.
 */

/** This package's version. Plugins can self-check at runtime via `ctx.host.sdkVersion`. */
export const SDK_VERSION = "0.3.20";

/**
 * Compare dotted numeric versions; >0 when a is newer. Missing segments count as 0
 * ("0.3" equals "0.3.0").
 *
 * Segments must be non-negative integer strings: any non-numeric segment (empty,
 * negative, fractional) throws an Error rather than silently returning NaN and
 * distorting the comparison. The loader's version string is already vetted by
 * validateManifest / the Rust install-time check, so the normal path never hits this.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (const segs of [pa, pb]) {
    for (const seg of segs) {
      if (!/^\d+$/.test(seg)) {
        throw new Error(`compareVersions: non-numeric segment "${seg}" in "${segs.join(".")}"`);
      }
    }
  }
  const na = pa.map(Number);
  const nb = pb.map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Minimal semver range evaluation (a deliberately boring implementation — no semver
 * dependency): supports "*" / absent, exact "0.2.0", "^x.y.z", "~x.y.z", ">=x.y.z".
 * Anything else is treated as unsatisfied (the plugin author gets a clear
 * incompatible error instead of being let through silently).
 * Caret left-anchoring for a 0 major version (semver):
 * - "^0.2" is "^0.2.0" and allows only 0.2.x;
 * - "^0.0" (patch omitted) allows any 0.0.x — consistent with "^0.2"'s omitted semantics;
 * - "^0.0.3" anchors exactly at 0.0.3 (within 0.0.x the patch is the breaking slot).
 */
export function satisfiesSdkRange(range: string | undefined, version: string): boolean {
  const r = (range ?? "*").trim();
  if (r === "*" || r === "") return true;
  const v = version.split(".").map(Number);
    // The patch segment may be omitted only with an operator ("^0.2" is "^0.2.0"); a bare exact match needs all three segments.
  const m = r.match(/^(\^|~|>=)?\s*(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return false;
  const [, op, maj, min, pat] = m;
  if (!op && pat === undefined) return false;
  const base = `${maj}.${min}.${pat ?? "0"}`;
  if (op === ">=") return compareVersions(version, base) >= 0;
  if (op === "^") {
    if (Number(maj) > 0) return v[0] === Number(maj) && compareVersions(version, base) >= 0;
      // 0.x: ^0.2 allows only 0.2.x (semver's left-anchoring rule for a 0 major version)
    if (Number(min) > 0) {
      return v[0] === 0 && v[1] === Number(min) && compareVersions(version, base) >= 0;
    }
      // ^0.0: patch omitted = any 0.0.x; with patch = anchored exactly at that patch.
    if (pat === undefined) return v[0] === 0 && v[1] === 0;
    return v[0] === 0 && v[1] === 0 && v[2] === Number(pat);
  }
  if (op === "~") {
    return v[0] === Number(maj) && v[1] === Number(min) && compareVersions(version, base) >= 0;
  }
  return compareVersions(version, base) === 0;
}
