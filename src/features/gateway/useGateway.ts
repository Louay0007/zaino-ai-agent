/**
 * Gateway session state for the shell: checking → logged-out → ready.
 * The live key never enters React state — only status, entitled aliases,
 * quota figures, and the last mapped error.
 */

import { useCallback, useEffect, useState } from "react";
import { listen } from "@/lib/transport";
import { ipc, parseGatewayError, type GatewayErrorEvent, type GatewayQuota, type GatewayPromptQuota, type GatewayStatus, type GatewayAccount } from "@/lib/ipc";

export type GatewayUiState = "checking" | "logged-out" | "ready" | "unavailable";

export interface UseGateway {
  state: GatewayUiState;
  models: string[];
  account: GatewayAccount | null;
  proxyUp: boolean;
  quota: GatewayQuota | null;
  promptQuota: GatewayPromptQuota | null;
  lastError: GatewayErrorEvent | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
  refreshQuota: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useGateway(): UseGateway {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [quota, setQuota] = useState<GatewayQuota | null>(null);
  const [promptQuota, setPromptQuota] = useState<GatewayPromptQuota | null>(null);
  const [lastError, setLastError] = useState<GatewayErrorEvent | null>(null);
  const [failed, setFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const s = await ipc.gatewayStatus();
        setStatus(s);
        setFailed(false);
        // The proxy binds during app startup and the first status poll can
        // race ahead of it. Keep retrying until it reports up (or down for
        // good) so the UI doesn't stick on the stale "bridge down" banner.
        if (s.proxyUp || !s.configured) return;
      } catch {
        setFailed(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }, []);

  const refreshQuota = useCallback(async () => {
    try {
      const [q, pq, e] = await Promise.all([
        ipc.gatewayQuota(),
        ipc.gatewayPromptQuota(),
        ipc.gatewayLastError(),
      ]);
      setQuota(q);
      setPromptQuota(pq);
      if (e) setLastError(e);
    } catch {
      // Quota is display-only; a failed poll keeps the last snapshot and
      // its age chip rather than blanking the meter.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Live error events from the proxy (budget/model/auth/rate failures).
    // Quota is re-pulled on every event so the banner shows fresh figures.
    let unlisten: (() => void) | undefined;
    void listen<GatewayErrorEvent>("gateway://error", ({ payload }) => {
      setLastError(payload);
      void refreshQuota();
    }).then((u) => {
      unlisten = u;
    }).catch(() => {});
    return () => unlisten?.();
  }, [refreshQuota]);

  useEffect(() => {
    // Slow meter poll (local snapshot only — no gateway traffic).
    const id = window.setInterval(() => {
      void refreshQuota();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refreshQuota]);

  const logout = useCallback(async () => {
    try {
      await ipc.gatewayLogout();
    } catch (e) {
      setErrorCode(parseGatewayError(e).code);
    } finally {
      await refresh();
    }
  }, [refresh]);

  const base = {
    errorCode,
    refresh,
    refreshQuota,
    logout,
    quota,
    promptQuota,
    lastError,
    account: status?.account ?? null,
  };
  if (failed) return { ...base, state: "unavailable", models: [], proxyUp: false };
  if (!status) return { ...base, state: "checking", models: [], proxyUp: false };
  if (!status.configured) return { ...base, state: "logged-out", models: [], proxyUp: status.proxyUp };
  return { ...base, state: "ready", models: status.models, proxyUp: status.proxyUp, account: status.account };
}
