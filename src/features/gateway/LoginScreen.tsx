/**
 * Zaino login screen: device-code sign-in (primary) or paste-once key (fallback).
 *
 * Two tracks:
 *  - "Sign in with Zaino": the backend requests a device code, opens the
 *    portal in the system browser, and polls until the user approves. The
 *    `zn-…` key never enters the renderer — approval arrives as an
 *    `Approved` event whose display data (org, email, aliases) this screen
 *    renders before handing off to the app.
 *  - "Paste device key": the previous manual flow, kept as the fallback
 *    (portal Keys page → paste → gateway validation → channel wiring).
 *
 * Every failure maps to a sentence, never a code. Cancellation always
 * lands back on the entry screen with nothing stored.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { ipc, parseGatewayError } from "@/lib/ipc";
import { openExternal } from "@/lib/platform";
import { PORTAL_KEYS_URL } from "./constants";
import { setupClaudeChannel } from "./setup";
import { useDeviceFlow } from "./useDeviceFlow";
import { suggestDeviceName, validateDeviceKeyInput } from "./validate";

type EntryPhase = { step: "entry" };
type PastePhase =
  | { step: "portal" }
  | { step: "key"; portalOpened: boolean }
  | { step: "working" }
  | { step: "done"; models: string[]; defaultModel: string };
type Phase = EntryPhase | PastePhase;

const LOGIN_ERROR_I18N: Record<string, string> = {
  invalid_key: "gateway.login.errors.invalidKey",
  unauthorized: "gateway.login.errors.unauthorized",
  no_models_entitled: "gateway.login.errors.noModels",
  unreachable: "gateway.login.errors.offline",
  proxy_down: "gateway.login.errors.proxyDown",
  keychain_unavailable: "gateway.login.errors.keychain",
};

const DEVICE_ERROR_I18N: Record<string, string> = {
  denied: "gateway.login.deviceFlow.denied",
  expired: "gateway.login.deviceFlow.expired",
  upstream: "gateway.login.deviceFlow.upstream",
  upstream_error: "gateway.login.deviceFlow.upstream",
  unreachable: "gateway.login.deviceFlow.upstream",
  payment_required: "gateway.login.deviceFlow.paymentRequired",
  forbidden: "gateway.login.deviceFlow.forbidden",
};

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ step: "entry" });
  const [deviceName] = useState(suggestDeviceName);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const device = useDeviceFlow();

  async function submitKey() {
    const checked = validateDeviceKeyInput(key);
    if (!checked.ok) {
      setErrorKey("gateway.login.errors.shape");
      setErrorMessage(null);
      return;
    }
    setBusy(true);
    setErrorKey(null);
    setErrorMessage(null);
    try {
      const aliases = await ipc.gatewayLogin(checked.key);
      setPhase({ step: "working" });
      const { defaultModel } = await setupClaudeChannel(aliases);
      setPhase({ step: "done", models: [...aliases].sort(), defaultModel });
    } catch (e) {
      const parsed = parseGatewayError(e);
      setErrorKey(LOGIN_ERROR_I18N[parsed.code] ?? null);
      setErrorMessage(LOGIN_ERROR_I18N[parsed.code] ? null : parsed.message);
    } finally {
      setBusy(false);
    }
  }

  function copyDeviceName() {
    void navigator.clipboard
      ?.writeText(deviceName)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  function copyUserCode(code: string) {
    void navigator.clipboard?.writeText(code).catch(() => {});
  }

  const deviceState = device.state;
  if (deviceState.phase === "awaiting-browser") {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">{t("gateway.login.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("gateway.login.deviceFlow.waiting")}</p>
          <div className="mt-6 grid gap-4">
            <div>
              <Label htmlFor="user-code">{t("gateway.login.deviceFlow.userCodeLabel")}</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="user-code"
                  value={deviceState.userCode}
                  isReadOnly
                  className="font-mono text-center text-lg tracking-widest"
                />
                <Button variant="secondary" onClick={() => copyUserCode(deviceState.userCode)}>
                  {t("gateway.login.copy")}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("gateway.login.deviceFlow.codeHint")}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => openExternal(deviceState.verificationUrl)}
            >
              {t("gateway.login.deviceFlow.openBrowser")}
            </Button>
            <Button variant="ghost" onClick={() => void device.cancel()}>
              {t("gateway.login.deviceFlow.cancel")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (deviceState.phase === "approved") {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">
            {t("gateway.login.deviceFlow.approvedTitle", { org: deviceState.orgName || "Zaino" })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {deviceState.email
              ? t("gateway.login.deviceFlow.signedInAs", { email: deviceState.email })
              : t("gateway.login.ready", { model: deviceState.defaultModel })}
          </p>
          <ul className="mt-4 grid gap-1 text-sm text-muted-foreground">
            {deviceState.models.map((m) => (
              <li key={m} className="font-mono">
                · {m}
              </li>
            ))}
          </ul>
          <Button variant="primary" className="mt-6 w-full" onClick={onDone}>
            {t("gateway.login.start")}
          </Button>
        </div>
      </div>
    );
  }

  if (
    deviceState.phase === "expired" ||
    deviceState.phase === "cancelled" ||
    deviceState.phase === "error"
  ) {
    const message =
      deviceState.phase === "cancelled"
        ? t("gateway.login.deviceFlow.cancelled")
        : deviceState.phase === "expired"
        ? t("gateway.login.deviceFlow.expired")
        : DEVICE_ERROR_I18N[deviceState.code]
        ? t(DEVICE_ERROR_I18N[deviceState.code])
        : deviceState.message;
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">{t("gateway.login.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <div className="mt-6 grid gap-2">
            <Button
              variant="primary"
              onClick={() => {
                device.reset();
                void device.begin();
              }}
            >
              {deviceState.phase === "expired"
                ? t("gateway.login.deviceFlow.retryAfterExpiry")
                : t("gateway.login.deviceFlow.retry")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                device.reset();
                setPhase({ step: "entry" });
              }}
            >
              {t("gateway.login.pasteDeviceKey")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // deviceState.phase === "idle" — the entry screen + paste fallback below.
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">{t("gateway.login.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("gateway.login.subtitle")}</p>

        {phase.step === "entry" && (
          <div className="mt-6 grid gap-4">
            <p className="text-sm text-foreground">{t("gateway.login.deviceFlow.intro")}</p>
            <Button variant="primary" onClick={() => void device.begin()}>
              {t("gateway.login.signInWithZaino")}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => setPhase({ step: "portal" })}
            >
              {t("gateway.login.pasteDeviceKey")}
            </button>
          </div>
        )}

        {phase.step === "portal" && (
          <div className="mt-6 grid gap-4">
            <p className="text-sm text-foreground">{t("gateway.login.step1")}</p>
            <div>
              <Label htmlFor="device-name">{t("gateway.login.deviceName")}</Label>
              <div className="mt-1 flex gap-2">
                <Input id="device-name" value={deviceName} isReadOnly className="font-mono" />
                <Button
                  variant="secondary"
                  onClick={copyDeviceName}
                  aria-label={t("gateway.login.copy")}
                >
                  {copied ? t("gateway.login.copied") : t("gateway.login.copy")}
                </Button>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                openExternal(`${PORTAL_KEYS_URL}?device=${encodeURIComponent(deviceName)}`);
                setPhase({ step: "key", portalOpened: true });
              }}
            >
              {t("gateway.login.openPortal")}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => setPhase({ step: "key", portalOpened: false })}
            >
              {t("gateway.login.alreadyHaveKey")}
            </button>
          </div>
        )}

        {(phase.step === "key" || phase.step === "working") && (
          <form
            className="mt-6 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void submitKey();
            }}
          >
            <div>
              <Label htmlFor="device-key">{t("gateway.login.keyLabel")}</Label>
              <Input
                id="device-key"
                type="password"
                autoComplete="off"
                spellCheck="false"
                value={key}
                onChange={(v) => {
                  setKey(v);
                  setErrorKey(null);
                  setErrorMessage(null);
                }}
                placeholder="zn-…"
                isDisabled={busy}
                className="mt-1 font-mono"
              />
              <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                {errorKey ? t(errorKey) : errorMessage ?? t("gateway.login.keyHint")}
              </p>
            </div>
            <Button variant="primary" type="submit" disabled={busy || key.trim().length === 0}>
              {busy ? t("gateway.login.verifying") : t("gateway.login.signIn")}
            </Button>
          </form>
        )}

        {phase.step === "done" && (
          <div className="mt-6 grid gap-4">
            <p className="text-sm text-foreground">{t("gateway.login.ready", { model: phase.defaultModel })}</p>
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {phase.models.map((m) => (
                <li key={m} className="font-mono">
                  · {m}
                </li>
              ))}
            </ul>
            <Button variant="primary" onClick={onDone}>
              {t("gateway.login.start")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
