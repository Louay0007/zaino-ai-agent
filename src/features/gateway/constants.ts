/**
 * Zaino endpoints, channel identity, portal links. One module so a host
 * change is a one-line diff — but keep in sync with the Rust twin
 * `src-tauri/src/gateway/mod.rs::GATEWAY_BASE_URL` (the proxy forwards
 * there; this copy is informational metadata only). These are OUR
 * first-party hosts — hard req. 5 forbids non-gateway hosts, not these.
 */

export const GATEWAY_BASE_URL = "https://api.zaino.soon.it";
export const PORTAL_BASE_URL = "https://zaino.soon.it";
// Keep in sync with the Rust twin `src-tauri/src/gateway/device.rs::PORTAL_BASE_URL`.
export const PORTAL_DEVICE_URL = `${PORTAL_BASE_URL}/api/auth/device`;
export const PORTAL_DEVICE_VERIFY_URL = `${PORTAL_BASE_URL}/api/auth/device/verify`;
export const PORTAL_DEVICE_TOKEN_URL = `${PORTAL_BASE_URL}/api/auth/device/token`;
export const PORTAL_KEYS_URL = `${PORTAL_BASE_URL}/dashboard/keys`;
export const PORTAL_BILLING_URL = `${PORTAL_BASE_URL}/dashboard/billing`;
export const GATEWAY_CHANNEL_ID = "zaino";
export const GATEWAY_MARKER = "zaino-v1";


export function isGatewayProvider(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>).gateway === GATEWAY_MARKER
  );
}
