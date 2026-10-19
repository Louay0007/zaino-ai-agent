import { describe, expect, it } from "vitest";
import { ageString, deriveQuotaUi, formatMoney } from "./quota";
import type { GatewayErrorEvent, GatewayQuota } from "@/lib/ipc";

const NOW = 1_000_000;

function quota(over: Partial<GatewayQuota> = {}): GatewayQuota {
  return {
    spend: null,
    cap: null,
    fetchedAt: null,
    source: "unknown",
    blockedAt: null,
    ...over,
  };
}

function err(code: string, at: number = NOW - 60): GatewayErrorEvent {
  return { code, message: code, status: 429, at };
}

describe("deriveQuotaUi", () => {
  it("is unknown with no figures and no error", () => {
    expect(deriveQuotaUi(null, null, NOW)).toEqual({ kind: "unknown" });
    expect(deriveQuotaUi(quota(), null, NOW)).toEqual({ kind: "unknown" });
  });

  it("is ok below the soft line", () => {
    expect(deriveQuotaUi(quota({ spend: 0.4, cap: 1 }), null, NOW)).toEqual({
      kind: "ok",
      pct: 0.4,
    });
  });

  it("goes soft at 80%", () => {
    expect(deriveQuotaUi(quota({ spend: 0.8, cap: 1 }), null, NOW)).toEqual({
      kind: "soft",
      pct: 0.8,
    });
  });

  it("hard-blocks on a fresh budget error, not on stale ones", () => {
    const hard = deriveQuotaUi(quota({ spend: 1, cap: 1 }), err("budget_exhausted"), NOW);
    expect(hard.kind).toBe("hard");
    const stale = deriveQuotaUi(
      quota({ spend: 1, cap: 1 }),
      err("budget_exhausted", NOW - 3600),
      NOW,
    );
    expect(stale.kind).toBe("soft");
  });

  it("distinguishes model and auth blocks from budget blocks", () => {
    expect(deriveQuotaUi(quota(), err("model_blocked"), NOW).kind).toBe("hard");
    expect(deriveQuotaUi(quota(), err("unauthorized"), NOW).kind).toBe("hard");
    // A throttling 429 is transient, never a block.
    expect(deriveQuotaUi(quota({ spend: 0.1, cap: 1 }), err("rate_limited"), NOW)).toEqual({
      kind: "ok",
      pct: 0.1,
    });
  });

  it("falls back to the recorded block when the event is missed", () => {
    const ui = deriveQuotaUi(quota({ spend: 1, cap: 1, blockedAt: NOW - 10 }), null, NOW);
    expect(ui.kind).toBe("hard");
  });
});

describe("formatters", () => {
  it("formats money with ledger precision", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0.0001)).toBe("$0.0001");
    expect(formatMoney(19)).toBe("$19.00");
  });

  it("ages snapshots honestly", () => {
    expect(ageString(null, NOW)).toBeNull();
    expect(ageString(NOW - 10, NOW)).toBe("just now");
    expect(ageString(NOW - 300, NOW)).toBe("5m ago");
  });
});
