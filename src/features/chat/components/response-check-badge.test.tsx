import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { ResponseCheckState } from "../response-check";
import { ResponseCheckBadge } from "./response-check-badge";

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("ResponseCheckBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(check: ResponseCheckState) {
    act(() => {
      root.render(<ResponseCheckBadge check={check} />);
    });
  }

  const trigger = () => container.querySelector("button");

  it("uses a neutral question badge for an unresolved request alias", () => {
    render({
      requested: { model: "opus", comparisonModel: null, effort: "high" },
      served: { model: "claude-opus-5-5", effort: null },
    });
    expect(trigger()!.getAttribute("aria-label")).toBe("Response verification: unable to verify");
    expect(trigger()!.className).not.toContain("text-text-warning-primary");
  });

  it("checks the resolved alias against the concrete response model", () => {
    render({
      requested: {
        model: "opus",
        comparisonModel: "claude-opus-5-5",
        effort: "high",
      },
      served: { model: "claude-opus-5-5", effort: null },
    });
    expect(trigger()!.getAttribute("aria-label")).toBe("Response check: matches the response");
  });

  it("renders nothing until a side was reported", () => {
    render({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: null, effort: null },
    });
    expect(trigger()).toBeNull();
  });

  it("marks a matching response with the default-colored check", () => {
    render({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: "claude-opus-5-5", effort: "xhigh" },
    });
    const button = trigger()!;
    expect(button.getAttribute("aria-label")).toBe("Response check: matches the response");
    expect(button.className).toContain("text-foreground-icon-quaternary");
  });

  it("treats a dated snapshot as the requested family, not a substitution", () => {
    render({
      requested: { model: "claude-opus-4-5", effort: null },
      served: { model: "claude-opus-4-5-20251101", effort: null },
    });
    expect(trigger()!.getAttribute("aria-label")).toBe("Response check: matches the response");
  });

  it("keeps a green check when the model matches but effort is unreported", () => {
    render({
      requested: { model: "claude-opus-4-5", effort: "max" },
      served: { model: "claude-opus-4-5", effort: null },
    });
    const button = trigger()!;
    expect(button.getAttribute("aria-label")).toBe("Response check: matches the response");
    expect(button.className).toContain("text-foreground-icon-quaternary");
  });

  it("flags a served response that differs from the request", () => {
    render({
      requested: { model: "gpt-6-astra", effort: "max" },
      served: { model: "gpt-5.6-luna", effort: "low" },
    });
    const button = trigger()!;
    expect(button.getAttribute("aria-label")).toBe("Response check: differs from the response");
    expect(button.className).toContain("text-text-warning-primary");
  });

  it("shows the original selector and its resolution in the card", async () => {
    vi.useFakeTimers();
    try {
      for (const comparisonModel of ["claude-opus-5-5", null]) {
        render({
          requested: { model: "opus", comparisonModel, effort: "high" },
          served: { model: "claude-opus-5-5", effort: null },
        });
        await act(async () => {
          trigger()!.focus();
          vi.advanceTimersByTime(400);
        });
        const text = document.querySelector('[role="tooltip"]')!.textContent;
        expect(text).toContain(
          comparisonModel ? "opus → claude-opus-5-5" : "opus · Unable to verify",
        );
        expect(text).not.toContain("Mismatch");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the card listing both sides on focus", async () => {
    vi.useFakeTimers();
    try {
      render({
        requested: { model: "gpt-6-astra", effort: "max" },
        served: { model: "gpt-5.6-luna", effort: null },
      });
      const button = trigger()!;
      await act(async () => {
        button.focus();
        vi.advanceTimersByTime(400);
      });
      const card = document.querySelector('[role="tooltip"]');
      expect(card).not.toBeNull();
      const text = card!.textContent ?? "";
      expect(text).toContain("Response check");
      expect(text).toContain("Requested model");
      expect(text).toContain("gpt-6-astra");
      expect(text).toContain("gpt-5.6-luna");
      // An unreported side reads as unreported, never as a pass.
      expect(text).toContain("Responded effort");
      expect(text).toContain("Not reported");
    } finally {
      vi.useRealTimers();
    }
  });
});
