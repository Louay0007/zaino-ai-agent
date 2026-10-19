import { describe, expect, it } from "vitest";
import { suggestDeviceName, validateDeviceKeyInput } from "./validate";

describe("device key input validation", () => {
  it("rejects empty input", () => {
    expect(validateDeviceKeyInput("")).toEqual({ ok: false, problem: "empty" });
    expect(validateDeviceKeyInput("   ")).toEqual({ ok: false, problem: "empty" });
  });

  it("rejects non-key shapes without network", () => {
    expect(validateDeviceKeyInput("sk-abcdef").ok).toBe(false);
    expect(validateDeviceKeyInput("zn-short").ok).toBe(false);
    expect(validateDeviceKeyInput("https://portal/x").ok).toBe(false);
  });

  it("accepts a plausible key and trims it", () => {
    const r = validateDeviceKeyInput("  zn-ABCdef0123456789XYZ  ");
    expect(r).toEqual({ ok: true, key: "zn-ABCdef0123456789XYZ" });
  });

  it("suggests distinct desktop- names", () => {
    const a = suggestDeviceName();
    const b = suggestDeviceName();
    expect(a).toMatch(/^desktop-[0-9a-f]{4}$/);
    expect(a).not.toBe(b);
  });
});
