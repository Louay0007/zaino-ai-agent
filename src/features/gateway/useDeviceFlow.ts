/**
 * Device-code sign-in driver for the LoginScreen.
 *
 * Thin renderer over the backend flow: the Rust side requests the device
 * code, polls the portal, and finishes the login itself. This hook only
 * carries DISPLAY data (user code, verification URL, phases) — the `zn-…`
 * key never enters React state, logs, or component snapshots.
 *
 * Phases: idle → awaiting-browser → approved | expired | cancelled | error.
 * A terminal phase stays until `reset()` (retry) or `begin()` again. Only
 * one run can be active at a time — the backend supersedes a previous run
 * on a second `begin()`.
 */

import { useCallback, useEffect, useState } from "react";
import { listen } from "@/lib/transport";
import { ipc, parseGatewayError, type DeviceBegin, type DevicePhase } from "@/lib/ipc";
import { openExternal } from "@/lib/platform";
import { setupClaudeChannel } from "./setup";

export type DeviceFlowState =
  | { phase: "idle" }
  | {
      phase: "awaiting-browser";
      userCode: string;
      verificationUrl: string;
      expiresIn: number;
      interval: number;
    }
  | {
      phase: "approved";
      models: string[];
      defaultModel: string;
      email: string;
      orgName: string;
    }
  | { phase: "expired" }
  | { phase: "cancelled" }
  | { phase: "error"; code: string; message: string };

export interface DeviceFlow {
  state: DeviceFlowState;
  begin: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useDeviceFlow(): DeviceFlow {
  const [state, setState] = useState<DeviceFlowState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DevicePhase>("gateway://device", ({ payload }) => {
      switch (payload.phase) {
        case "awaiting-browser":
          // begin() already rendered this from the invoke response; the
          // event is the backend's duplicate confirmation.
          break;
        case "approved": {
          const evt = payload;
          // Wire the Claude channel + default model from the PROVED aliases
          // (the backend already validated them against the gateway).
          void setupClaudeChannel(evt.models)
            .then(({ defaultModel }) => {
              setState({
                phase: "approved",
                models: [...evt.models].sort(),
                defaultModel,
                email: evt.email,
                orgName: evt.org_name,
              });
            })
            .catch((e) => {
              const parsed = parseGatewayError(e);
              setState({ phase: "error", code: parsed.code, message: parsed.message });
            });
          break;
        }
        case "expired":
          setState({ phase: "expired" });
          break;
        case "cancelled":
          setState({ phase: "cancelled" });
          break;
        case "error":
          setState({ phase: "error", code: payload.code, message: payload.message });
          break;
      }
    }).then((u) => {
      unlisten = u;
    }).catch(() => {});
    return () => unlisten?.();
  }, []);

  const begin = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const issued: DeviceBegin = await ipc.gatewayDeviceBegin();
      openExternal(issued.verification_url);
      setState({
        phase: "awaiting-browser",
        userCode: issued.user_code,
        verificationUrl: issued.verification_url,
        expiresIn: issued.expires_in,
        interval: issued.interval,
      });
    } catch (e) {
      const parsed = parseGatewayError(e);
      setState({ phase: "error", code: parsed.code, message: parsed.message });
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const cancel = useCallback(async () => {
    try {
      await ipc.gatewayDeviceCancel();
    } catch {
      // Backend already idle — the UI transition below is what matters.
    } finally {
      setState({ phase: "cancelled" });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  return { state, begin, cancel, reset };
}
