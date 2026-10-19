/** Preset tables and config templates for ProviderDialog, ported from the
 *  reference desktop-cc-gui's features/vendors/types.ts. */

import type { EngineId } from "./providers";

export interface ProviderPreset {
  /** Brand-literal display name (same convention as CLI_DISPLAY_NAMES). */
  name: string;
  baseUrl: string;
  model: string;
  /** Explicit provider mark; model inference is unsafe for relay presets
   *  whose default model belongs to a different brand (e.g. OpenCode Go). */
  iconSrc: string;
  /** Monochrome SVGs use currentColor, which stays black inside an <img>;
   *  invert them in dark mode so they remain visible. */
  iconClassName?: string;
  /** claude: extra env merged into the JSON config on preset pick —
   *  ANTHROPIC_DEFAULT_<TIER>_MODEL slots plus per-provider tuning vars. */
  env?: Record<string, string>;
  /** codex: wire_api for the generated config.toml (default "chat" — the
   *  relays below are chat-completions compatible). */
  wireApi?: "responses" | "chat";
}

/** Claude-only: the official direct endpoint. Selecting the official card
 *  locks API URL to this value, mirroring the reference's 官方直连 preset. */
export const OFFICIAL_BASE_URL = "https://api.anthropic.com";
export const OFFICIAL_CODEX_BASE_URL = "https://api.openai.com/v1";

/** Model-slot env keys, in the grid's display order. */
export const CLAUDE_MODEL_SLOTS = [
  { slot: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { slot: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { slot: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { slot: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
] as const;
export type ClaudeModelSlot = (typeof CLAUDE_MODEL_SLOTS)[number]["slot"];

/** The reference's default settings.json template for a new Claude channel. */
export function buildDefaultClaudeSettings(): Record<string, unknown> & {
  env: Record<string, string>;
} {
  return {
    alwaysThinkingEnabled: true,
    autoDreamEnabled: true,
    cleanupPeriodDays: 720,
    effortLevel: "xhigh",
    env: {
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
      ANTHROPIC_BETAS: "context-1m-2025-08-07",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_NEW_INIT: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
      MAX_THINKING_TOKENS: "31999",
      MCP_TIMEOUT: "60000",
    },
    hasCompletedOnboarding: true,
    language: "English",
    model: "opus",
    skipAutoPermissionPrompt: true,
    teammateMode: "in-process",
    tui: "fullscreen",
  };
}

/** Fresh settings.json text for a claude channel: the default template with
 *  the endpoint, the user's token and any preset env merged in. */
export function claudeTemplateJson(
  baseUrl: string,
  apiKey: string,
  extraEnv: Record<string, string> = {},
): string {
  const config = buildDefaultClaudeSettings();
  config.env.ANTHROPIC_BASE_URL = baseUrl;
  config.env.ANTHROPIC_AUTH_TOKEN = apiKey;
  for (const [key, val] of Object.entries(extraEnv)) {
    config.env[key] = val;
  }
  return JSON.stringify(config, null, 2);
}

// ── codex config.toml ───────────────────────────────────────────────────────

const tomlString = (value: string): string => JSON.stringify(value);

/** The reference's buildCodexProviderConfigToml: a managed config.toml with
 *  one model_providers table. */
export function buildCodexConfigToml(
  providerName: string,
  baseUrl: string,
  model: string,
  wireApi: "responses" | "chat" = "responses",
  providerId = "custom",
): string {
  return `model = ${tomlString(model)}
model_reasoning_effort = "high"
model_provider = ${tomlString(providerId)}

[model_providers.${providerId}]
base_url = ${tomlString(baseUrl)}
name = ${tomlString(providerName)}
requires_openai_auth = true
wire_api = ${tomlString(wireApi)}`;
}

export const DEFAULT_CODEX_AUTH_JSON = `{
  "OPENAI_API_KEY": ""
}`;

export const OFFICIAL_CODEX_CONFIG_TOML = buildCodexConfigToml(
  "openai",
  OFFICIAL_CODEX_BASE_URL,
  "gpt-5.1-codex",
  "responses",
  "openai",
);

/** First `base_url = "…"` in a config.toml — display/preset-match mirror; the
 *  backend applies the TOML itself, this is only for the UI. */
export function tomlBaseUrl(toml: string): string {
  return toml.match(/^\s*base_url\s*=\s*"([^"]*)"/m)?.[1] ?? "";
}

/** Top-level `model = "…"`. */
export function tomlModel(toml: string): string {
  return toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
}

/** OPENAI_API_KEY out of an auth.json text; "" when unparseable/absent. */
export function authJsonApiKey(authJson: string): string {
  try {
    const parsed: unknown = JSON.parse(authJson);
    if (parsed && typeof parsed === "object") {
      const key = (parsed as Record<string, unknown>).OPENAI_API_KEY;
      return typeof key === "string" ? key : "";
    }
  } catch {
    // invalid JSON — the dialog surfaces this separately
  }
  return "";
}

// ── preset tables ───────────────────────────────────────────────────────────

/** Third-party relay presets per engine. Claude's table is ported from the
 *  reference's CLAUDE_PROVIDER_PRESETS (per-tier model env included); codex's
 *  from CODEX_PROVIDER_PRESETS (wire_api drives the generated config.toml). */
export const PRESETS: Partial<Record<EngineId, ProviderPreset[]>> = {
  // Zaino fork (M1): all third-party vendor presets removed (hard req. 5 —
  // no non-gateway hosts). Channels are custom-only; the gateway channel is
  // created by the login flow, not picked from a preset list.
};

/** The preset matching the current URL; the empty 自定义 URL matches nothing. */
export function findMatchedPreset(
  presets: ProviderPreset[],
  baseUrl: string,
): ProviderPreset | undefined {
  return presets.find((p) => p.baseUrl === baseUrl && p.baseUrl !== "");
}

/** The reference's isOfficialAnthropicEndpoint: empty and api.anthropic.com
 *  (any scheme/path) count as official. */
export function isOfficialAnthropicEndpoint(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized === "") return true;
  try {
    return new URL(normalized).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}
