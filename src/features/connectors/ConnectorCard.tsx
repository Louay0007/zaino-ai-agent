/** One connector card in the marketplace grid: brand logo, name, description, install status.
 *  Craft floor: tight groups, generous separation, real brand marks, one authored hover moment. */
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Download from "lucide-react/dist/esm/icons/download";
import { Button } from "@/components/base/buttons/button";
import { ConnectorLogo } from "./ConnectorLogo";
import type { ConnectorDef } from "./types";

export function ConnectorCard({
  connector,
  installed,
  installing,
  removing,
  onInstall,
  onRemove,
}: {
  connector: ConnectorDef;
  installed: boolean;
  installing: boolean;
  removing: boolean;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const busy = installing || removing;

  return (
    <div className="group relative flex flex-col gap-4 rounded-2xl border border-separator-border bg-background-secondary-default p-5 transition-all duration-200 ease-out hover:border-border-primary hover:shadow-sm">
      {/* Top row: logo + status */}
      <div className="flex items-start justify-between">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background-primary-default ring-1 ring-inset ring-separator-border transition-colors group-hover:ring-border-primary">
          <ConnectorLogo icon={connector.icon} className="size-5 text-text-secondary" />
        </div>
        {installed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-caption-1-medium text-green-600 dark:text-green-400">
            <Check className="size-3" aria-hidden />
            {t("connectors.installed")}
          </span>
        )}
      </div>

      {/* Name + description */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-body-medium text-text-primary">{connector.name}</h3>
        <p className="line-clamp-2 text-body-2-regular leading-relaxed text-text-tertiary">
          {connector.description}
        </p>
      </div>

      {/* Metadata row: category + docs */}
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-background-primary-default px-2 py-0.5 text-caption-1-regular text-text-tertiary">
          {connector.category}
        </span>
        {connector.docsUrl && (
          <a
            href={connector.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-caption-1-regular text-text-tertiary transition-colors hover:text-text-primary"
          >
            <ExternalLink className="size-3" aria-hidden />
            {t("connectors.docs")}
          </a>
        )}
      </div>

      {/* Action button — full width, never clipped */}
      <div className="mt-auto pt-1">
        {installed ? (
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={onRemove}
            className="w-full justify-center"
          >
            {removing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-3.5" aria-hidden />
            )}
            {t("connectors.remove")}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="small"
            disabled={busy}
            onClick={onInstall}
            className="w-full justify-center"
          >
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {t("connectors.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
