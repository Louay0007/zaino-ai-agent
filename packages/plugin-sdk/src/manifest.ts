import type { PluginContext } from "./context";

/**
  * The manifest (ccgui.plugin.json / a release's manifest.json, plan §5.1) and
  * its base types. Zero runtime dependencies (types only), so Node validation
  * scripts can import it directly.
 */

/** Undo handle returned by every registration; unload runs them in reverse
 *  order of registration (cordis-style effect/dispose). */
export type Disposer = () => void;

/** Trust tiers (ADR-1). "declarative" bundles carry no JS. */
export type PluginTier = "declarative" | "js";

/** The single plugin entry convention (ADR-5): the host dynamically imports
 * main.js, then calls the default export. */
export type PluginActivate = (ctx: PluginContext) => void | (() => void);
/** Safe stable plugin id: total length 2..=64 bytes, dot-separated segments
 *  each matching `[a-z0-9][a-z0-9-]*` (first byte lowercase alphanumeric,
 *  the rest lowercase alphanumerics or hyphens). Empty/dot-only/path-like
 *  segments reject, as does a lone one-character id.
 *
 *  Kept byte-for-byte identical to Rust `is_valid_id`
 *  (src-tauri/src/plugins/manifest.rs) — ids double as directory names, so
 *  this is also the path-traversal guard. Shared vectors:
 *  spec/permissions.json `pluginIdShapes`. */
export function isValidPluginId(id: string): boolean {
  return (
    id.length >= 2 &&
    id.length <= 64 &&
    /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(id)
  );
}


export interface PluginManifest {
  id: string;
  name: string;
  /** Semver three segments (x.y.z). */
  version: string;
  /** The minimum host version required. */
  minAppVersion?: string;
  /** The SDK version range required ("^0.4" / "~0.4.0" / ">=0.4.0" / exact / "*").
   *  Default = "*" (no check). When the host SDK does not satisfy it the plugin
   *  goes incompatible. */
  sdkVersion?: string;
  author?: string;
  description?: string;
  tier: PluginTier;
  /** Base permissions and `network:`/`exec:` grants; the full set and shape
   *  rules live in spec/permissions.json (the single source of truth).
   *  `network:none` is a base permission (declares no network), never a grant. */
  permissions: string[];
  contributes?: {
    themes?: { name?: string; tokens: { light?: Record<string, string>; dark?: Record<string, string> } }[];
    i18n?: { lang: string; ns?: string; resources: Record<string, unknown> }[];
    /** Tier-0 static status-bar text chips (plan §5.1). Localize by
     *  pairing with an i18n bundle; JS plugins render their own component
     *  via ctx.ui.registerStatusBarItem instead. */
    statusBarItems?: { key?: string; text: string }[];
    /** Tier-0 palette commands; running one emits `emits` (default
     *  `plugin:<id>:command:<key>`) on the event bus so other plugins or
     *  the host can react. Anything richer needs a JS plugin. */
    commands?: { key: string; title: string; emits?: string }[];
  };
  /** JSON Schema object; the settings UI auto-renders a config form. */
  configSchema?: JsonSchemaObject;
  /** A square icon for the marketplace: a repo-relative path (recommended under
   *  `docs/`, e.g. `docs/icon.png`) or an absolute https URL. Default = the
   *  marketplace renders a tile with the plugin name's first letter. A panel tab
   *  that registers no `icon` also falls back to it: marketplace installs copy
   *  the indexed brand image into the plugin directory by relative path (the
   *  release package need not bundle the image), and an absolute URL is loaded
   *  over the network directly. */
  icon?: string;
  /** Marketplace detail-page screenshots: a repo-relative path or an absolute
   *  https URL, up to 5, shown in array order. Default = the detail page renders
   *  no gallery. Images are read by path from the plugin repo's default branch,
   *  so swapping them needs no release. */
  screenshots?: string[];
}

/** Subset of JSON Schema the declarative config form renders. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
}
