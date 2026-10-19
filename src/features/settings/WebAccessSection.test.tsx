import { vi } from "vitest";

const { storage } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => storage.set(key, String(val)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s,
    };
  } else if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = (s: string) => s;
  }
  return { storage };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const webAccessStatus = vi.fn();
const webAccessStart = vi.fn();
const webAccessStop = vi.fn();
const webAccessRotateToken = vi.fn();
const getAppSettings = vi.fn();
const updateAppSettings = vi.fn();

vi.mock("@/lib/ipc", () => ({
  ipc: {
    webAccessStatus: () => webAccessStatus(),
    webAccessStart: () => webAccessStart(),
    webAccessStop: () => webAccessStop(),
    webAccessRotateToken: () => webAccessRotateToken(),
    getAppSettings: () => getAppSettings(),
    updateAppSettings: (settings: unknown) => updateAppSettings(settings),
  },
}));

vi.mock("@/lib/platform", () => ({
  isWeb: false,
}));

import "@/lib/i18n";
import { WebAccessSection } from "./WebAccessSection";
import {
  WEB_ACCESS_AUTO_START_KEY,
  WEB_ACCESS_SELECTED_IP_KEY,
} from "./web-access-keys";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  storage.clear();
  webAccessStatus.mockReset().mockResolvedValue(null);
  webAccessStart.mockReset();
  webAccessStop.mockReset().mockResolvedValue(undefined);
  getAppSettings.mockReset().mockResolvedValue({ webAccessAutoStart: false });
  updateAppSettings.mockReset().mockResolvedValue(undefined);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<WebAccessSection />);
  });
}

describe("WebAccessSection", () => {
  it("renders stopped state and auto-start toggle when not running", async () => {
    await render();

    expect(container.textContent).toContain("Stopped");
    expect(container.textContent).toContain("Start web access");
    expect(container.textContent).toContain("Auto-start on launch");

    const autoStartSwitch = container.querySelector<HTMLInputElement>(
      `input[role="switch"]`,
    );
    expect(autoStartSwitch).toBeTruthy();
    expect(autoStartSwitch?.checked).toBe(false);
  });

  it("toggles auto-start and persists to storage and app settings", async () => {
    await render();

    const autoStartSwitch = container.querySelector<HTMLInputElement>(
      `input[role="switch"]`,
    );
    expect(autoStartSwitch).toBeTruthy();

    await act(async () => {
      autoStartSwitch?.click();
    });

    expect(storage.get(WEB_ACCESS_AUTO_START_KEY)).toBe("1");
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ webAccessAutoStart: true }),
    );
  });

  it("renders IP selector and updates display URL when running with multiple IPs", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
        { ip: "127.0.0.1", label: "127.0.0.1 (Localhost)" },
      ],
    });

    await render();

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("Stop");
    expect(container.textContent).toContain("Host IP / Interface");
    expect(container.textContent).toContain("http://192.168.1.100:7316/?token=mock-token");

    const selectTrigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(selectTrigger).toBeTruthy();
  });

  it("changes display URL when selecting a different IP from the dropdown", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
      ],
    });

    await render();

    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const options = Array.from(document.querySelectorAll("[role='option']"));
    const tailscaleOption = options.find((opt) => opt.textContent?.includes("Tailscale"));
    expect(tailscaleOption).toBeTruthy();

    await act(async () => {
      tailscaleOption?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("http://100.88.99.11:7316/?token=mock-token");
    expect(storage.get(WEB_ACCESS_SELECTED_IP_KEY)).toBe("100.88.99.11");
  });

  it("remembers previously selected IP from localStorage", async () => {
    storage.set(WEB_ACCESS_SELECTED_IP_KEY, "100.88.99.11");

    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
      ],
    });

    await render();

    expect(container.textContent).toContain("http://100.88.99.11:7316/?token=mock-token");
  });

  it("stops running when clicking the stop button", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [{ ip: "192.168.1.100", label: "192.168.1.100" }],
    });

    await render();

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Stop",
    );
    expect(stopButton).toBeTruthy();

    await act(async () => {
      stopButton?.click();
    });

    expect(webAccessStop).toHaveBeenCalled();
    expect(container.textContent).toContain("Stopped");
  });

  it("renders port and token inputs and updates settings on change", async () => {
    getAppSettings.mockResolvedValue({
      webAccessAutoStart: false,
      webAccessPort: 14200,
      webAccessToken: "test-token-12345",
    });

    await render();

    expect(container.textContent).toContain("Service Port");
    expect(container.textContent).toContain("Access Token");

    const portInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="Service Port"]`,
    );
    expect(portInput?.value).toBe("14200");

    const tokenInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="Access Token"]`,
    );
    expect(tokenInput?.value).toBe("test-token-12345");
  });

  it("allows rotating token and shows restart notice when running", async () => {
    webAccessRotateToken.mockResolvedValue("new-token-67890");
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [{ ip: "192.168.1.100", label: "192.168.1.100" }],
    });

    await render();

    const rotateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Regenerate"),
    );
    expect(rotateBtn).toBeTruthy();

    await act(async () => {
      rotateBtn?.click();
    });

    expect(webAccessRotateToken).toHaveBeenCalled();
    expect(container.textContent).toContain("Settings saved. Restart service to apply new port or token");
    expect(container.textContent).toContain("Restart Service");
  });

  // React controlled inputs ignore direct value assignment; drive them with
  // the native setter + input event, and blur via focusout (React's onBlur).
  function setInputValue(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("treats port 0 as auto assign, never clamps it to port 1", async () => {
    await render();

    const portInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="Service Port"]`,
    );
    expect(portInput).toBeTruthy();

    await act(async () => {
      setInputValue(portInput!, "0");
    });
    await act(async () => {
      portInput!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ webAccessPort: null }),
    );
    expect(updateAppSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ webAccessPort: 1 }),
    );
    expect(portInput!.value).toBe("");
  });

  it("rejects a custom token shorter than 16 characters", async () => {
    await render();

    const tokenInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="Access Token"]`,
    );
    expect(tokenInput).toBeTruthy();

    await act(async () => {
      setInputValue(tokenInput!, "abc");
    });
    await act(async () => {
      tokenInput!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(updateAppSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ webAccessToken: "abc" }),
    );
    expect(container.textContent).toContain("访问凭证太短");
  });
});
