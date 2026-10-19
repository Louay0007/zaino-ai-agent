/**
 * Soft/hard gateway banners. Rendered above the chat tree in MainApp —
 * persistent while their condition holds, never a modal (the user may
 * need to read the error while acting on it).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { openExternal } from "@/lib/platform";
import { PORTAL_BILLING_URL } from "./constants";
import { deriveQuotaUi, type QuotaUi } from "./quota";
import type { GatewayErrorEvent, GatewayQuota } from "@/lib/ipc";

interface Props {
  quota: GatewayQuota | null;
  lastError: GatewayErrorEvent | null;
  onReLogin: () => void;
  onDismissSoft?: () => void;
}

export function GatewayBanners({ quota, lastError, onReLogin }: Props) {
  const { t } = useTranslation();
  const [softDismissed, setSoftDismissed] = useState(false);
  const now = Math.floor(Date.now() / 1000);
  const ui = deriveQuotaUi(quota, lastError, now);

  // The local gateway bridge is an internal implementation detail; a transient
  // down state must not surface a blocking banner. Sending stays guarded by
  // the backend's fail-closed proxy anyway.
  if (ui.kind === "hard") {
    return <HardBanner ui={ui} onReLogin={onReLogin} />;
  }
  if (ui.kind === "soft" && !softDismissed) {
    const pct = Math.round(ui.pct * 100);
    return (
      <Banner
        tone="warn"
        title={t("gateway.soft.title")}
        body={t("gateway.soft.body", { pct })}
        actionLabel={t("gateway.soft.manage")}
        onAction={() => openExternal(PORTAL_BILLING_URL)}
        onDismiss={() => setSoftDismissed(true)}
      />
    );
  }
  return null;
}

function HardBanner({
  ui,
  onReLogin,
}: {
  ui: Extract<QuotaUi, { kind: "hard" }>;
  onReLogin: () => void;
}) {
  const { t } = useTranslation();
  if (ui.code === "unauthorized") {
    return (
      <Banner
        tone="danger"
        title={t("gateway.blocked.reauthTitle")}
        body={t("gateway.blocked.reauthBody")}
        actionLabel={t("gateway.blocked.reauthAction")}
        onAction={onReLogin}
      />
    );
  }
  if (ui.code === "model_blocked") {
    return (
      <Banner
        tone="danger"
        title={t("gateway.blocked.modelTitle")}
        body={t("gateway.blocked.modelBody")}
      />
    );
  }
  return (
    <Banner
      tone="danger"
      title={t("gateway.blocked.title")}
      body={t("gateway.blocked.body")}
      actionLabel={t("gateway.blocked.upgrade")}
      onAction={() => openExternal(PORTAL_BILLING_URL)}
    />
  );
}

function Banner({
  tone,
  title,
  body,
  actionLabel,
  onAction,
  onDismiss,
}: {
  tone: "warn" | "danger" | "neutral";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/50 bg-destructive/10"
      : tone === "warn"
        ? "border-amber-600/40 bg-amber-500/10"
        : "border-border bg-muted";
  return (
    <div className={`mx-4 mt-3 rounded-xl border px-4 py-3 ${toneClass}`} role="alert">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{body}</p>
        </div>
        {actionLabel && onAction ? (
          <Button variant={tone === "danger" ? "primary" : "secondary"} size="small" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button variant="ghost" size="small" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </Button>
        ) : null}
      </div>
    </div>
  );
}
