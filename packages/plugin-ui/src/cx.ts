/**
 * Lightweight className merge: concatenates the truthy parts. Plugins have no
 * Tailwind, so tailwind-merge's conflict resolution is unnecessary — pui-* class names
 * never collide, and a plugin's own class passed later simply wins.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
