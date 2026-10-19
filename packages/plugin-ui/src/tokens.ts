/**
 * The public contract for host semantic tokens (a compatibility promise).
 *
 * All plugin-ui styles consume only the CSS custom properties in this list; the host
 * (desktop-cc-gui src/styles/theme.css) promises:
 *   1. it never renames or removes a token in the list;
 *   2. every semantic token is defined under both light and .dark (components write no
 *      dark: branch; light/dark follows the host token flip entirely).
 *
 * Every style declaration carries a light-theme fallback (var(--token, fallback)), so if
 * a token ever goes missing the plugin degrades to the light default look rather than breaking.
 *
 * Host-side regression test: src/features/plugins/plugin-ui-tokens.test.ts asserts
 * theme.css still defines these tokens one by one — a rename fails immediately.
 *
 * Adding a token = extending the contract (minor); changing a meaning or deleting one
 * = breaking it (this package releases a major). */
export const PLUGIN_UI_TOKEN_CONTRACT = [
  /* Fonts / shapes / shadows (the @theme layer, constant across themes) */
  "--font-sans",
  "--radius-2lg",
  "--shadow-card",
  "--shadow-dropdown",
  /* Text */
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-placeholder",
  "--color-text-white",
  "--color-text-error-primary",
  "--color-notification-success-foreground",
  /* Backgrounds */
  "--color-background-primary-default",
  "--color-background-secondary-default",
  "--color-background-tertiary-default",
  "--color-background-tertiary-hover",
  /* Borders */
  "--color-border-button-default",
  "--color-border-button-hover",
  "--color-separator-border",
  "--color-border-focus-ring",
  "--color-border-error-default",
  /* Accent / bubbles */
  "--color-accent-500",
  "--color-accent-600",
  "--color-bubble-user",
  /* Primary button gradient and its disabled state */
  "--gradient-button-primary-default",
  "--gradient-button-primary-hover",
  "--gradient-button-primary-active",
  "--gradient-button-primary-disabled",
  "--color-button-primary-disabled-foreground",
] as const;

export type PluginUiToken = (typeof PLUGIN_UI_TOKEN_CONTRACT)[number];
