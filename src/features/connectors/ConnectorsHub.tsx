/**
 * Connectors Hub: marketplace of pre-configured MCP servers with one-click install.
 * Craft floor: generous page rhythm, clear section hierarchy, one authored success moment,
 * no nested cards, real brand marks, breathing room between groups.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Plug from "lucide-react/dist/esm/icons/plug";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { LocalOnlyNotice } from "@/components/application/settings/local-only-notice";
import { isWeb } from "@/lib/transport";
import { useChatStore } from "@/features/chat/store";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectorConfigModal } from "./ConnectorConfigModal";
import { useConnectors } from "./useConnectors";
import type { ConnectorDef, InstallConnectorResult } from "./types";

/** Auto-dismissing success/error toast — replaces the raw [engine] message block. */
function ResultToast({
  result,
  onDismiss,
}: {
  result: InstallConnectorResult;
  onDismiss: () => void;
}) {
  const allSuccess = result.results.every((r) => r.success);
  const anySuccess = result.results.some((r) => r.success);

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-all duration-300 ease-out ${
        allSuccess
          ? "border-green-500/20 bg-green-500/8 text-green-700 dark:text-green-400"
          : anySuccess
            ? "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-400"
            : "border-red-500/20 bg-red-500/8 text-red-600 dark:text-red-400"
      }`}
    >
      {allSuccess ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 opacity-80" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 opacity-80" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body-2-medium">
          {allSuccess
            ? "Connector installed successfully"
            : anySuccess
              ? "Partially installed — check details below"
              : "Installation failed"}
        </p>
        {result.results.length > 1 || !allSuccess ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {result.results.map((r) => (
              <p key={r.engine} className="text-caption-1-regular opacity-80">
                {r.engine}: {r.message}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-0.5 text-caption-1-regular opacity-80">
            {result.results[0]?.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function ConnectorsHub() {
  const { t } = useTranslation();
  const activeWorkspace = useChatStore((s) => s.active?.workspacePath ?? null);
  const {
    catalog,
    loading,
    installing,
    removing,
    lastResult,
    install,
    remove,
    isInstalled,
    refresh,
  } = useConnectors(activeWorkspace);

  const [configTarget, setConfigTarget] = useState<ConnectorDef | null>(null);
  const [dismissedResult, setDismissedResult] = useState<string | null>(null);

  // Reset dismissed state when a new result arrives
  useEffect(() => {
    if (lastResult) setDismissedResult(null);
  }, [lastResult]);

  if (isWeb) {
    return (
      <div className="flex flex-col gap-6 p-8">
        <h2 className="text-title-2-medium text-text-primary">{t("connectors.title")}</h2>
        <LocalOnlyNotice message="Connectors are managed locally via CLI config files — not available in web mode." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <CenteredSpinner />
      </div>
    );
  }

  const showResult = lastResult && dismissedResult !== lastResult.connectorId;

  return (
    <div className="flex flex-col gap-8 p-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-background-secondary-default ring-1 ring-inset ring-separator-border">
            <Plug className="size-4 text-text-secondary" aria-hidden />
          </div>
          <div>
            <h2 className="text-title-2-medium text-text-primary">{t("connectors.title")}</h2>
            <p className="text-body-3-regular text-text-tertiary">
              Extend your AI with external tools and data sources
            </p>
          </div>
        </div>
        <Button variant="secondary" size="small" onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" aria-hidden />
          {t("connectors.refresh")}
        </Button>
      </div>

      {/* Success / error toast */}
      {showResult && (
        <ResultToast
          result={lastResult}
          onDismiss={() => setDismissedResult(lastResult.connectorId)}
        />
      )}

      {/* Marketplace grid */}
      {catalog.length === 0 ? (
        <EmptyState className="py-20 text-body-2-regular">{t("connectors.empty")}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              installed={isInstalled(connector.name)}
              installing={installing === connector.id}
              removing={removing === connector.id}
              onInstall={() => {
                if (connector.envVars.length > 0) {
                  setConfigTarget(connector);
                } else {
                  void install(connector.id, {}, connector.engines);
                }
              }}
              onRemove={() => void remove(connector.id, connector.engines)}
            />
          ))}
        </div>
      )}

      {/* Config modal */}
      {configTarget && (
        <ConnectorConfigModal
          connector={configTarget}
          installing={installing === configTarget.id}
          onInstall={(envValues) => {
            void install(configTarget.id, envValues, configTarget.engines).then(() =>
              setConfigTarget(null),
            );
          }}
          onClose={() => setConfigTarget(null)}
        />
      )}
    </div>
  );
}
