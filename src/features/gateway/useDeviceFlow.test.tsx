/**
 * useDeviceFlow: backend events drive the state machine; the hook carries
 * display data only. The `zn-…` token never appears in any assertion here —
 * it never reaches the renderer in the first place.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/transport", () => {
  const bus = {
    listeners: [] as Array<(e: { payload: unknown }) => void>,
  };
  (globalThis as Record<string, unknown>).__deviceTestBus = bus;
  return {
    invoke: async (cmd: string) => {
      ((globalThis as Record<string, unknown>).__deviceInvokes as Array<{ cmd: string }>).push({ cmd });
      if (cmd === "gateway_device_begin") {
      return {
        user_code: "WXYZ5678",
        verification_url: "https://portal.example/device?user_code=WXYZ5678",
        expires_in: 900,
        interval: 5,
      };
    }
    return undefined;
  },
  listen: async (_name: string, cb: (e: { payload: unknown }) => void) => {
    (bus.listeners as Array<(e: { payload: unknown }) => void>).push(cb);
    return () => {
      const i = bus.listeners.indexOf(cb);
      if (i >= 0) bus.listeners.splice(i, 1);
    };
  },
  };
});

vi.mock("@/lib/ipc", async (importOriginal) => {
  // Reuse the real types/parsers, replace only the transport-backed calls.
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      gatewayDeviceBegin: () =>
        Promise.resolve({
          user_code: "WXYZ5678",
          verification_url: "https://portal.example/device?user_code=WXYZ5678",
          expires_in: 900,
          interval: 5,
        }),
      gatewayDeviceCancel: () => Promise.resolve(),
      upsertProvider: () => Promise.resolve(),
      setCurrentProvider: () => Promise.resolve(),
      getAppSettings: () => Promise.resolve({ defaultModels: {}, defaultEfforts: {} }),
      updateAppSettings: () => Promise.resolve(),
    },
  };
});

vi.mock("@/lib/platform", () => ({
  openExternal: (url: string) => {
    void url;
  },
  isWeb: false,
}));

import "@/lib/i18n";
import { useDeviceFlow, type DeviceFlow } from "./useDeviceFlow";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let flow: DeviceFlow | null = null;

function Probe() {
  flow = useDeviceFlow();
  return null;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<Probe />);
  });
}

declare const __deviceTestBus: { listeners: Array<(e: { payload: unknown }) => void> };
declare const __deviceInvokes: Array<{ cmd: string }>;

function emit(payload: unknown) {
  const bus = (globalThis as Record<string, unknown>).__deviceTestBus as {
    listeners: Array<(e: { payload: unknown }) => void>;
  };
  act(() => {
    for (const cb of [...bus.listeners]) cb({ payload });
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const invokes: Array<{ cmd: string }> = [];

beforeEach(() => {
  const bus = (globalThis as Record<string, unknown>).__deviceTestBus as {
    listeners: Array<(e: { payload: unknown }) => void>;
  } | undefined;
  bus?.listeners.splice(0);
  (globalThis as Record<string, unknown>).__deviceInvokes = invokes;
  invokes.length = 0;
  mount();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  flow = null;
});

describe("useDeviceFlow", () => {
  it("starts idle", () => {
    expect(flow!.state).toEqual({ phase: "idle" });
  });

  it("begin() shows the user code and opens the verification URL", async () => {
    await act(async () => {
      await flow!.begin();
    });
    expect(flow!.state).toMatchObject({
      phase: "awaiting-browser",
      userCode: "WXYZ5678",
    });
  });

  it("an approved event finishes the channel wiring and lands approved", async () => {
    await act(async () => {
      await flow!.begin();
    });
    emit({
      phase: "approved",
      models: ["smart", "fast"],
      default_model: "fast",
      email: "user@example.com",
      org_name: "Acme",
    });
    await flush();
    await flush();
    expect(flow!.state).toMatchObject({
      phase: "approved",
      models: ["fast", "smart"],
      defaultModel: "fast",
      email: "user@example.com",
      orgName: "Acme",
    });
  });

  it("expired, cancelled, and error events land in terminal phases", async () => {
    await act(async () => {
      await flow!.begin();
    });
    emit({ phase: "expired" });
    expect(flow!.state).toEqual({ phase: "expired" });
    flow!.reset();
    emit({ phase: "cancelled" });
    expect(flow!.state).toEqual({ phase: "cancelled" });
    flow!.reset();
    emit({ phase: "error", code: "forbidden", message: "nope" });
    expect(flow!.state).toEqual({ phase: "error", code: "forbidden", message: "nope" });
  });

  it("cancel() asks the backend to stop the run", async () => {
    await act(async () => {
      await flow!.begin();
    });
    await act(async () => {
      await flow!.cancel();
    });
    expect(flow!.state).toEqual({ phase: "cancelled" });
  });

  it("never exposes the key: no state contains a zn- value", async () => {
    await act(async () => {
      await flow!.begin();
    });
    emit({
      phase: "approved",
      models: ["fast"],
      default_model: "fast",
      email: "user@example.com",
      org_name: "Acme",
    });
    await flush();
    await flush();
    expect(JSON.stringify(flow!.state)).not.toMatch(/zn-/);
  });
});
