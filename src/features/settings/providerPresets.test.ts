/**
 * Preset-table removal (Zaino fork, M1): all third-party vendor rows are
 * gone — channels are custom-only. The template builders below are kept:
 * the ProviderDialog still hand-builds custom Claude/Codex channels from
 * them, and these tests pin their output shape.
 */
import { describe, expect, it } from "vitest";
import {
  buildCodexConfigToml,
  claudeTemplateJson,
  findMatchedPreset,
} from "./providerPresets";
import type { ProviderPreset } from "./providerPresets";

const syntheticClaude: ProviderPreset = {
  name: "Synthetic",
  baseUrl: "https://gateway.example/v1",
  model: "fast",
  iconSrc: "",
  env: {
    ANTHROPIC_DEFAULT_FABLE_MODEL: "fast",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "fast",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "fast",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "fast",
  },
};

describe("custom Claude channel template", () => {
  it("writes the root endpoint and tier models into settings env", () => {
    const settings = JSON.parse(
      claudeTemplateJson(syntheticClaude.baseUrl, "test-key", syntheticClaude.env),
    );
    expect(new URL("/v1/messages", settings.env.ANTHROPIC_BASE_URL).href).toBe(
      "https://gateway.example/v1/messages",
    );
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe("test-key");
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("fast");
    expect(findMatchedPreset([syntheticClaude], syntheticClaude.baseUrl)).toBe(syntheticClaude);
  });
});

describe("custom Codex channel template", () => {
  it("generates a Responses configuration", () => {
    const config = buildCodexConfigToml("Synthetic", "https://gateway.example/v1", "fast", "responses");
    expect(config).toContain('base_url = "https://gateway.example/v1"');
    expect(config).toContain('model = "fast"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain("disable_response_storage");
  });
});
