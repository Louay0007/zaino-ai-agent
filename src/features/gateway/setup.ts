/**
 * Post-login wiring: point Claude at the Zaino channel and default its
 * model to the first entitled alias. Uses only existing IPC (upsert,
 * set-current, settings read/write) — no new backend surface.
 *
 * The channel JSON carries the gateway MARKER plus loopback-agnostic
 * fields only: baseUrl is informational (the Rust override replaces the
 * env at send time), there is deliberately NO apiKey field at all —
 * a missing secret cannot leak, be displayed, or be synced anywhere.
 */

import { ipc } from "@/lib/ipc";
import { GATEWAY_BASE_URL, GATEWAY_CHANNEL_ID, GATEWAY_MARKER } from "./constants";

export interface GatewaySetupResult {
  defaultModel: string;
}

export async function setupClaudeChannel(aliases: string[]): Promise<GatewaySetupResult> {
  const sorted = [...aliases].sort();
  const defaultModel = sorted[0];
  if (!defaultModel) throw new Error("no-entitled-models");
  const channel = {
    gateway: GATEWAY_MARKER,
    baseUrl: GATEWAY_BASE_URL,
    model: defaultModel,
  };
  await ipc.upsertProvider("claude", GATEWAY_CHANNEL_ID, channel);
  await ipc.setCurrentProvider("claude", GATEWAY_CHANNEL_ID);
  const settings = await ipc.getAppSettings();
  await ipc.updateAppSettings({
    ...settings,
    defaultModels: { ...settings.defaultModels, claude: defaultModel },
  });
  return { defaultModel };
}
