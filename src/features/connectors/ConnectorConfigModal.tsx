/** Modal for configuring a connector's env vars before installation.
* Craft floor: generous internal spacing, clear label hierarchy, one authored focus moment,
* security notice as a quiet callout (not an alarm), actions pinned with breathing room. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ConnectorLogo } from "./ConnectorLogo";
import type { ConnectorDef } from "./types";

export function ConnectorConfigModal({
  connector,
  installing,
  onInstall,
  onClose,
}: {
  connector: ConnectorDef;
  installing: boolean;
  onInstall: (envValues: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of connector.envVars) init[v.key] = "";
    return init;
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const canInstall = connector.envVars.every(
    (v) => !v.required || (values[v.key]?.trim() ?? "") !== "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInstall || installing) return;
    onInstall(values);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-separator-border bg-background-primary-default shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: logo + title + close */}
        <div className="flex items-center gap-3 border-b border-separator-border px-6 py-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-secondary-default ring-1 ring-inset ring-separator-border">
            <ConnectorLogo icon={connector.icon} className="size-4 text-text-secondary" />
          </div>
          <h2 className="flex-1 text-title-3-medium text-text-primary">
            {t("connectors.configureTitle", { name: connector.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-background-secondary-hover hover:text-text-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-5">
          {/* Security notice — quiet callout, not alarm */}
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/8 px-3.5 py-3 text-body-2-regular leading-relaxed text-amber-700 dark:text-amber-400/90">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
            <span>{t("connectors.secretWarning")}</span>
          </div>

          {/* Env var fields */}
          {connector.envVars.length === 0 ? (
            <p className="py-2 text-body-2-regular text-text-tertiary">
              {t("connectors.noConfigNeeded")}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {connector.envVars.map((envVar) => {
                const isSecret = envVar.secret;
                const visible = showSecrets[envVar.key] ?? false;
                return (
                  <div key={envVar.key} className="flex flex-col gap-2">
                    <label className="flex items-center gap-1 text-body-2-medium text-text-secondary">
                      {envVar.label}
                      {envVar.required && (
                        <span className="text-red-500" aria-label="required">*</span>
                      )}
                    </label>
                    <p className="text-body-3-regular leading-relaxed text-text-tertiary">
                      {envVar.description}
                    </p>
                    <div className="relative">
                      <Input
                        type={isSecret && !visible ? "password" : "text"}
                        value={values[envVar.key] ?? ""}
                        onChange={(val) =>
                          setValues((prev) => ({ ...prev, [envVar.key]: val }))
                        }
                        placeholder={envVar.placeholder ?? undefined}
                        className="pr-10"
                      />
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowSecrets((prev) => ({
                              ...prev,
                              [envVar.key]: !prev[envVar.key],
                            }))
                          }
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary transition-colors hover:text-text-primary"
                          aria-label={visible ? "Hide secret" : "Show secret"}
                        >
                          {visible ? (
                            <EyeOff className="size-3.5" aria-hidden />
                          ) : (
                            <Eye className="size-3.5" aria-hidden />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actions — pinned with breathing room */}
          <div className="flex justify-end gap-2.5 border-t border-separator-border pt-4">
            <Button variant="secondary" size="small" onClick={onClose} disabled={installing}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="small"
              type="submit"
              disabled={!canInstall || installing}
            >
              {installing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("connectors.install")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
