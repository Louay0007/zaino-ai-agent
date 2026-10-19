/**
 * Settings → Zaino gateway section: account card, per-model prompt usage
 * meters, entitled models, and actions. Registered in sections.tsx like
 * every builtin section (dogfooded extension point).
 *
 * Usage is prompt-count based (migration 0013): each inference request
 * counts as 1 prompt. Dollar-based spend is no longer the limiting factor
 * and is not displayed here.
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { useGateway } from "./useGateway";
import { ageString } from "./quota";
import { PORTAL_BILLING_URL } from "./constants";
import { openExternal } from "@/lib/platform";

const MODEL_ORDER = ["fast", "smart", "frontier"] as const;

const MODEL_LABELS: Record<string, string> = {
  fast: "Fast",
  smart: "Smart",
  frontier: "Frontier",
};

export function GatewaySection() {
  const { t } = useTranslation();
  const gw = useGateway();
  const now = Math.floor(Date.now() / 1000);

  if (gw.state === "checking") {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground animate-pulse">{t("gateway.section.checking")}</p>
      </div>
    );
  }
  if (gw.state !== "ready") {
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("gateway.section.notSignedIn")}</p>
      </div>
    );
  }

  const pq = gw.promptQuota;
  const age = ageString(pq?.fetchedAt ?? null, now);
  const planLabel = pq?.planCode ? pq.planCode.charAt(0).toUpperCase() + pq.planCode.slice(1) : null;

  // Build ordered model rows: only models that have a limit or usage.
  const modelRows = MODEL_ORDER.filter((m) => {
    const limit = pq?.promptLimits[m];
    const used = pq?.promptsUsed[m];
    return (limit != null && limit > 0) || (used != null && used > 0);
  }).map((model) => {
    const limit = pq?.promptLimits[model] ?? 0;
    const used = pq?.promptsUsed[model] ?? 0;
    const remaining = Math.max(0, limit - used);
    const pct = limit > 0 ? Math.min(1, used / limit) : 0;
    return { model, label: MODEL_LABELS[model] ?? model, limit, used, remaining, pct };
  });

  return (
    <div className="grid gap-6">
      {/* Account Card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("gateway.section.account")}
            </p>
            {gw.account ? (
              <div className="mt-2 grid gap-1">
                <p className="truncate text-base font-semibold text-foreground">
                  {gw.account.orgName}
                </p>
                <p className="truncate font-mono text-sm text-muted-foreground">
                  {gw.account.email}
                </p>
                {planLabel && (
                  <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {planLabel} Plan
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("gateway.section.accountUnknown")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Active
            </span>
          </div>
        </div>
      </div>

      {/* Prompt Usage Per Model */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("gateway.section.usage")}
          </p>
          {age && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t("gateway.section.asOf", { age })}
            </span>
          )}
        </div>

        {modelRows.length > 0 ? (
          <div className="mt-4 grid gap-4">
            {modelRows.map(({ model, label, limit, used, remaining, pct }) => {
              const isNearCap = pct >= 0.95;
              const isHighUsage = pct >= 0.8;
              const barColor = isNearCap
                ? "bg-red-500"
                : isHighUsage
                  ? "bg-amber-500"
                  : "bg-primary";
              const textColor = isNearCap
                ? "text-red-500"
                : isHighUsage
                  ? "text-amber-500"
                  : "text-foreground";

              return (
                <div key={model} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${textColor}`}>
                      {used.toLocaleString()} / {limit.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct * 100)}
                    aria-label={`${label} prompt usage`}
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${Math.round(pct * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {remaining.toLocaleString()} prompts remaining
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs italic text-muted-foreground">
            No usage yet — send a message and it shows up here.
          </p>
        )}

        {pq?.periodStart && pq?.periodEnd && (
          <p className="mt-4 text-[11px] text-muted-foreground">
            Billing period: {new Date(pq.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(pq.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
        )}
      </div>

      {/* Entitled Models */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("gateway.section.models")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {gw.models.length > 0 ? (
            gw.models.map((model) => (
              <span
                key={model}
                className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs font-medium text-foreground"
              >
                {MODEL_LABELS[model] ?? model}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="small" onClick={() => void gw.refreshQuota()}>
          {t("gateway.section.refresh")}
        </Button>
        <Button variant="secondary" size="small" onClick={() => openExternal(PORTAL_BILLING_URL)}>
          {t("gateway.section.manage")}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="small" onClick={() => void gw.logout()}>
          {t("gateway.section.signOut")}
        </Button>
      </div>
    </div>
  );
}