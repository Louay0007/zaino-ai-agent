/**
 * Pure quota UI state: snapshot + last error in, one render decision out.
 * Unit-tested; the hook only fetches, this decides.
 */

import type { GatewayErrorEvent, GatewayQuota } from "@/lib/ipc";

export type QuotaUi =
  | { kind: "unknown" }
  | { kind: "ok"; pct: number | null }
  | { kind: "soft"; pct: number }
  | { kind: "hard"; code: HardCode; at: number };

export type HardCode = "budget_exhausted" | "model_blocked" | "unauthorized";

const HARD_CODES: ReadonlySet<string> = new Set(["budget_exhausted", "model_blocked", "unauthorized"]);

function asHardCode(code: string): HardCode | null {
  return HARD_CODES.has(code) ? (code as HardCode) : null;
}
const ERROR_TTL_SECS = 30 * 60;

function ratioOf(q: GatewayQuota | null): number | null {
  if (!q || q.spend == null || q.cap == null || q.cap <= 0) return null;
  return q.spend / q.cap;
}

export function deriveQuotaUi(
  quota: GatewayQuota | null,
  lastError: GatewayErrorEvent | null,
  nowSecs: number,
): QuotaUi {
  if (lastError) {
    const hard = asHardCode(lastError.code);
    if (hard && nowSecs - lastError.at < ERROR_TTL_SECS) {
      return { kind: "hard", code: hard, at: lastError.at };
    }
  }
  // Backend-recorded block (survives event-listener gaps, e.g. fresh mount
  // before any new error fires — gateway_last_error usually covers this).
  if (quota?.blockedAt != null && nowSecs - quota.blockedAt < ERROR_TTL_SECS) {
    return { kind: "hard", code: "budget_exhausted", at: quota.blockedAt };
  }
  const pct = ratioOf(quota);
  if (pct == null) return { kind: "unknown" };
  if (pct >= 0.8) return { kind: "soft", pct };
  return { kind: "ok", pct };
}

export function formatMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function ageString(fetchedAt: number | null, nowSecs: number): string | null {
  if (fetchedAt == null) return null;
  const s = Math.max(0, nowSecs - fetchedAt);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
