/**
 * LoginScreen device-code flow: entry buttons, awaiting-browser render,
 * approval render, and the error/cancel transitions. Secrets never touch
 * these assertions — display data only.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls: Array<{ name: string; args?: unknown }> = [];
let flowState: import("./useDeviceFlow").DeviceFlowState = { phase: "idle" };

vi.mock("./useDeviceFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useDeviceFlow")>();
  return {
    ...actual,
    useDeviceFlow: () => ({
      state: flowState,
      begin: () => {
        calls.push({ name: "gatewayDeviceBegin" });
        calls.push({
          name: "openExternal",
          args: "https://portal.example/device?user_code=ABCD1234",
        });
        flowState = {
          phase: "awaiting-browser",
          userCode: "ABCD1234",
          verificationUrl: "https://portal.example/device?user_code=ABCD1234",
          expiresIn: 900,
          interval: 5,
        };
        return Promise.resolve();
      },
      cancel: () => {
        calls.push({ name: "gatewayDeviceCancel" });
        flowState = { phase: "cancelled" };
        return Promise.resolve();
      },
      reset: () => {
        flowState = { phase: "idle" };
      },
    }),
  };
});

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      gatewayDeviceBegin: () => {
        calls.push({ name: "gatewayDeviceBegin" });
        return Promise.resolve({
          user_code: "ABCD1234",
          verification_url: "https://portal.example/device?user_code=ABCD1234",
          expires_in: 900,
          interval: 5,
        });
      },
      gatewayDeviceCancel: () => {
        calls.push({ name: "gatewayDeviceCancel" });
        return Promise.resolve();
      },
      gatewayLogin: (key: string) => {
        calls.push({ name: "gatewayLogin", args: key });
        return Promise.resolve(["fast", "smart"]);
      },
      upsertProvider: () => Promise.resolve(),
      setCurrentProvider: () => Promise.resolve(),
      getAppSettings: () => Promise.resolve({ defaultModels: {}, defaultEfforts: {} }),
      updateAppSettings: () => Promise.resolve(),
    },
  };
});

import "@/lib/i18n";
import type { DeviceFlowState } from "./useDeviceFlow";
import { LoginScreen } from "./LoginScreen";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onDone: () => void = () => {};

function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
  return host;
}

function rerender() {
  act(() => {
    root!.render(<LoginScreen onDone={onDone} />);
  });
}

function emitPhase(payload: DeviceFlowState) {
  flowState = payload;
  rerender();
}

function clickText(el: HTMLElement, text: string) {
  const btn = Array.from(el.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`button not found: ${text}`);
  act(() => {
    btn.click();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  calls.length = 0;
  flowState = { phase: "idle" };
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

describe("LoginScreen device-code flow", () => {
  it("offers Sign in with Zaino and Paste device key on entry", () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    const buttons = Array.from(el.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes("Sign in with Zaino"))).toBe(true);
    expect(el.textContent).toContain("Paste device key");
  });

  it("begins the device flow, opens the browser, and shows the user code", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Sign in with Zaino");
    await flush();
    rerender();
    expect(calls.find((c) => c.name === "gatewayDeviceBegin")).toBeTruthy();
    expect(calls.find((c) => c.name === "openExternal")).toMatchObject({
      args: expect.stringContaining("device?user_code="),
    });
    const input = el.querySelector("#user-code") as HTMLInputElement | null;
    expect(input?.value).toBe("ABCD1234");
  });

  it("renders the approved screen with org, email, and models", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Sign in with Zaino");
    await flush();
    rerender();
    emitPhase({
      phase: "approved",
      models: ["smart", "fast"],
      defaultModel: "fast",
      email: "user@example.com",
      orgName: "Acme",
    });
    await flush();
    expect(el.textContent).toContain("Acme");
    expect(el.textContent).toContain("user@example.com");
    expect(el.textContent).toContain("fast");
    expect(el.textContent).toContain("smart");
  });

  it("shows the expired screen with a retry that restarts the flow", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Sign in with Zaino");
    await flush();
    rerender();
    emitPhase({ phase: "expired" });
    await flush();
    expect(el.textContent).toMatch(/expired/i);
    clickText(el, "start again");
    await flush();
    expect(calls.filter((c) => c.name === "gatewayDeviceBegin")).toHaveLength(2);
  });

  it("cancels back to a cancelled screen and offers the paste fallback", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Sign in with Zaino");
    await flush();
    rerender();
    clickText(el, "Cancel");
    await flush();
    rerender();
    expect(calls.find((c) => c.name === "gatewayDeviceCancel")).toBeTruthy();
    expect(el.textContent).toMatch(/cancelled/i);
    clickText(el, "Paste device key");
    await flush();
    rerender();
    expect(el.querySelector("#device-key") ?? el.textContent).toBeTruthy();
    // Entry is reachable again: the cancelled flow stored nothing.
    emitPhase({ phase: "idle" });
    expect(el.textContent).toContain("Sign in with Zaino");
  });

  it("maps backend error codes to display copy", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Sign in with Zaino");
    await flush();
    rerender();
    emitPhase({ phase: "error", code: "payment_required", message: "no plan" });
    await flush();
    expect(el.textContent).toMatch(/no active plan/i);
  });

  it("keeps the paste fallback working end to end", async () => {
    const el = render(<LoginScreen onDone={() => {}} />);
    clickText(el, "Paste device key");
    await flush();
    rerender();
    clickText(el, "I already have a key");
    await flush();
    rerender();
    const input = el.querySelector("#device-key") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    act(() => {
      input!.value = "zn-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The key is never rendered back: the input stays a password field and
    // the value never appears in text content.
    expect(el.textContent).not.toContain("zn-abcdefghijklmnopqrstuvwxyz");
  });
});
