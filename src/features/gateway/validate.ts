/**
 * Pure login-input validation (no IPC, no DOM) so the state machine below
 * and the UI copy are unit-testable. The backend re-validates everything —
 * this only fails fast on input that cannot possibly be a device key.
 */

export type KeyProblem = "empty" | "shape";

export function validateDeviceKeyInput(raw: string): { ok: true; key: string } | { ok: false; problem: KeyProblem } {
  const key = raw.trim();
  if (key.length === 0) return { ok: false, problem: "empty" };
  // Customer keys are `zn-` + 43 base64url chars (46 total); accept any
  // plausibly-long `zn-` value here and let the gateway be the judge —
  // rejecting a future key format client-side would lock users out.
  if (!key.startsWith("zn-") || key.length < 20) return { ok: false, problem: "shape" };
  return { ok: true, key };
}

/** Suggested portal key name, e.g. `desktop-a1b2`. Shown for the user to
 * type into the portal's key-name field so devices stay recognizable. */
export function suggestDeviceName(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `desktop-${hex}`;
}
