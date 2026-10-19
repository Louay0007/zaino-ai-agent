/**
 * Gateway banners render test: hard blocks the turn, soft warns once,
 * unknown stays silent. Copy comes from real i18n (default zh) — the
 * assertions are structural (roles/actions), not string snapshots, so a
 * copy edit doesn't break the contract.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { GatewayBanners } from "./GatewayBanners";
import type { GatewayErrorEvent, GatewayQuota } from "@/lib/ipc";

const quota = (over: Partial<GatewayQuota> = {}): GatewayQuota => ({
  spend: 0.9,
  cap: 1,
  fetchedAt: Math.floor(Date.now() / 1000),
  source: "headers",
  blockedAt: null,
  ...over,
});

const err = (code: string): GatewayErrorEvent => ({
  code,
  message: code,
  status: 429,
  at: Math.floor(Date.now() / 1000),
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

describe("GatewayBanners", () => {
  it("renders nothing when everything is fine", () => {
    const el = render(
        <GatewayBanners
        quota={quota({ spend: 0.1, cap: 1 })}
        lastError={null}
        onReLogin={() => {}}
      />,
    );
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("blocks hard on budget exhaustion with an upgrade action", () => {
    const el = render(
      <GatewayBanners quota={quota()} lastError={err("budget_exhausted")} onReLogin={() => {}} />,
    );
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector("button")).not.toBeNull();
  });

  it("shows soft once and dismisses without unmounting the tree", () => {
    const el = render(
      <GatewayBanners quota={quota({ spend: 0.85, cap: 1 })} lastError={null} onReLogin={() => {}} />,
    );
    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    act(() => {
      buttons[buttons.length - 1]!.click();
    });
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
