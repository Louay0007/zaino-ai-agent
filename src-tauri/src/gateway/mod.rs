//! Gateway custody root: secure storage, loopback proxy, model catalog,
//! quota snapshot, error mapping, and the per-send channel override.
//!
//! Design authority: `docs/gateway/02-adr.md` (hybrid/proxy, option C).
//! The live `zn-…` key exists in exactly two places: the OS keychain
//! (at rest, via [`store`]) and proxy process memory (at runtime, zeroized
//! on logout). It NEVER appears in `config.json`, native CLI configs,
//! child env, logs, IPC payloads, or the webview. Downstream (engines and
//! the proxy's own listeners) only ever see per-send dummy tokens.

pub mod catalog;
pub mod device;
pub mod error;
pub mod proxy;
pub mod quota;
pub mod store;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Mutex, OnceLock, RwLock};

use tauri::Emitter;
use zeroize::Zeroizing;

pub use self::error::GatewayError;

/// The Zaino gateway origin. Single constant on purpose (M1): it becomes a
/// setting in M5. This is OUR host — hard req. 5 forbids non-gateway hosts,
/// not our own.
pub const GATEWAY_BASE_URL: &str = "https://api.zaino.soon.it";

/// Marker field on a provider JSON object declaring it gateway-managed.
/// Never a secret: native files and `config.json` holding this marker
/// contain only the loopback URL + dummy key (see [`channels`]).
pub const GATEWAY_MARKER: &str = "zaino-v1";

/// Channel id the login flow registers under (per engine, M1: `claude`).
pub const GATEWAY_CHANNEL_ID: &str = "zaino";

/// Keychain service name. One entry, keyed by [`KEYCHAIN_USER`].
pub const KEYCHAIN_SERVICE: &str = "ai.zaino.desktop";
/// Keychain account. Fixed in M1 (one device key); per-device accounts
/// arrive with the multi-device milestone (M4).
pub const KEYCHAIN_USER: &str = "gateway-key";
/// Env var name the gateway integration points at. The send path injects
/// a per-send dummy under this name; the proxy swaps in the real key.
pub const GATEWAY_KEY_ENV: &str = "ZAINO_GATEWAY_KEY";

/// In-memory live key. `None` = logged out / never logged in.
static LIVE_KEY: RwLock<Option<Zeroizing<String>>> = RwLock::new(None);

/// Fixed loopback port. Ephemeral was the ADR's first choice, but M2's
/// per-engine registration work forced the question: native provider files
/// (codex TOML, pi/omp models.json/yml, opencode.json) cannot track an
/// ephemeral port without rewriting them every launch — churn that races
/// user edits and violates the "never rewrite native files" ethos. A fixed
/// 127.0.0.1 port makes every registration stable and secret-free; per-send
/// token rotation (not the port) carries the secrecy. Bind conflict =
/// proxy down = sends fail closed (single instance is the norm; a second
/// instance must not silently share the first one's proxy).
pub const PROXY_PORT: u16 = 18789;

/// Proxy socket address once the loopback server is up. `None` = down;
/// every send fails closed while down (ADR §5 invariant S2).
static PROXY_ADDR: OnceLock<Mutex<Option<SocketAddr>>> = OnceLock::new();

/// Per-send dummy tokens the proxy currently honors. Bounded + pruned on
/// insert (see [`proxy_channel_env`]). Never the real key.
static PROXY_TOKENS: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();

fn proxy_tokens() -> &'static Mutex<std::collections::HashSet<String>> {
    PROXY_TOKENS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Read the live key (cloned). Returns `None` when logged out.
pub fn live_key() -> Option<Zeroizing<String>> {
    LIVE_KEY.read().ok().and_then(|g| g.clone())
}

/// Install the live key (post keychain write). Overwrites silently: only
/// one device key is live at a time.
pub fn set_live_key(key: String) {
    if let Ok(mut g) = LIVE_KEY.write() {
        *g = Some(Zeroizing::new(key));
    }
}

/// Forget the live key. Zeroizes on drop via `Zeroizing`.
pub fn clear_live_key() {
    if let Ok(mut g) = LIVE_KEY.write() {
        *g = None;
    }
}

/// Record the bound proxy address. Called once at startup.
pub fn set_proxy_addr(addr: SocketAddr) {
    let cell = PROXY_ADDR.get_or_init(|| Mutex::new(None));
    if let Ok(mut g) = cell.lock() {
        *g = Some(addr);
    }
}

/// Quota snapshot, updated opportunistically from gateway traffic.
/// Display data only — never a send gate.
static QUOTA: OnceLock<Mutex<quota::QuotaSnapshot>> = OnceLock::new();

fn quota_cell() -> &'static Mutex<quota::QuotaSnapshot> {
    QUOTA.get_or_init(|| Mutex::new(quota::QuotaSnapshot::default()))
}

/// Current snapshot copy for the `gateway_quota` command.
pub fn quota_snapshot() -> quota::QuotaSnapshot {
    quota_cell().lock().map(|s| s.clone()).unwrap_or_default()
}

/// Fold response headers into the snapshot. No-op when the response
/// carries no quota headers (streams, non-LiteLLM shapes).
pub(crate) fn record_quota_headers(get: impl Fn(&str) -> Option<String>) {
    if let Ok(mut q) = quota_cell().lock() {
        quota::record_headers(&mut q, get);
    }
}

/// Last mapped gateway failure, for the banner + `gateway_last_error`.
static LAST_ERROR: OnceLock<Mutex<Option<GatewayEvent>>> = OnceLock::new();

/// App handle for `gateway://error` events. Set once at startup.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn set_app_handle(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

/// Emit a device-code event to the webview (display data only — no secrets).
pub(crate) fn emit_device(ev: &device::DeviceEvent) {
    if let Some(app) = APP.get() {
        let _ = app.emit(device::DEVICE_EVENT, ev);
    }
}

/// Error event payload: machine code for the UI switch, human sentence,
/// gateway status, unix time. No key material, no request bodies.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GatewayEvent {
    pub code: String,
    pub message: String,
    pub status: u16,
    pub at: u64,
}

/// Record a mapped gateway outcome: updates quota figures, remembers the
/// failure for the banner, and emits `gateway://error` for live UI.
/// Called on every non-2xx proxy response and on refresh failures.
pub(crate) fn report_outcome(status: u16, body: &str, retry_after: Option<u64>) {
    let mapped = error::GatewayError::from_status(status, body, retry_after);
    if let error::GatewayError::BudgetExhausted { spend, cap } = &mapped {
        if let Ok(mut q) = quota_cell().lock() {
            quota::record_budget_error(&mut q, *spend, *cap);
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let ev = GatewayEvent {
        code: mapped.code().to_string(),
        message: mapped.to_string(),
        status,
        at: now,
    };
    if let Ok(mut slot) = LAST_ERROR
        .get_or_init(|| Mutex::new(None))
        .lock()
    {
        *slot = Some(ev.clone());
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("gateway://error", &ev);
    }
}

/// Last recorded failure, if any (banner state on fresh mounts).
pub fn last_error() -> Option<GatewayEvent> {
    LAST_ERROR
        .get()
        .and_then(|c| c.lock().ok())
        .and_then(|g| g.clone())
}

/// Current proxy address, or `None` when the proxy is down.
pub fn proxy_addr() -> Option<SocketAddr> {
    PROXY_ADDR
        .get()
        .and_then(|c| c.lock().ok())
        .and_then(|g| *g)
}

/// Base URL children are pointed at, e.g. `http://127.0.0.1:18789`.
/// `None` = proxy down = sends must fail (callers: fail closed).
pub fn proxy_base_url() -> Option<String> {
    proxy_addr().map(|a| format!("http://{a}"))
}

/// True when a resolved provider JSON object is gateway-managed
/// (marker field, no secret material inspected or required).
pub fn is_gateway_provider(provider: Option<&serde_json::Value>) -> bool {
    provider
        .and_then(|p| p.get("gateway"))
        .and_then(serde_json::Value::as_str)
        == Some(GATEWAY_MARKER)
}

/// Env override for a gateway send, replacing whatever `channel_env`
/// produced. Per-send random dummy token, registered with the proxy;
/// the child authenticates to the PROXY with it, and the proxy injects
/// the real key upstream. The real key never crosses this boundary.
pub fn proxy_channel_env() -> Result<HashMap<String, String>, GatewayError> {
    let base = proxy_base_url().ok_or(GatewayError::ProxyDown)?;
    let default_model = catalog::default_alias().unwrap_or_else(|| "fast".to_string());
    let token = format!("sk-zaino-local-{}", uuid::Uuid::new_v4().as_simple());
    {
        let mut set = proxy_tokens().lock().map_err(|_| GatewayError::Internal)?;
        // Tokens live until logout so long-lived/persistent servers keep
        // working; 4096 turns per login is ample headroom. A full set
        // clears (fail-closed and loud for in-flight servers, never silent).
        if set.len() >= 4096 {
            set.clear();
        }
        set.insert(token.clone());
    }
    let mut env = HashMap::new();
    env.insert("ANTHROPIC_BASE_URL".to_string(), base.clone());
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), token.clone());
    env.insert("ANTHROPIC_MODEL".to_string(), default_model.clone());
    env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), default_model.clone());
    env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), default_model.clone());
    env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), default_model.clone());
    env.insert("ANTHROPIC_DEFAULT_FABLE_MODEL".to_string(), default_model.clone());
    env.insert("ANTHROPIC_SMALL_FAST_MODEL".to_string(), default_model.clone());
    env.insert("CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS".to_string(), "1".to_string());
    // Uniform pointer every registration file references
    // (`env_key`/`apiKeyEnv`/`{env:}`/`$ENV`): the per-send dummy the
    // proxy honors. Real key never leaves proxy memory.
    env.insert(crate::gateway::GATEWAY_KEY_ENV.to_string(), token);
    Ok(env)
}

/// Validate a downstream bearer token (constant-ish time not required:
/// localhost same-user boundary; the token is single-use-ish and short
/// lived — the upstream key is what's protected, and it never reaches here).
pub fn check_proxy_token(candidate: &str) -> bool {
    proxy_tokens()
        .lock()
        .map(|set| set.contains(candidate))
        .unwrap_or(false)
}

// ── Tauri commands ────────────────────────────────────────────────────

/// Frontend-visible status. `models` is the cached entitled list (may be
/// empty while logged out); `account` is the identity minted at device
/// approval (email / org name) and survives restart via the keychain. No
/// key material ever crosses this boundary.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub configured: bool,
    pub proxy_up: bool,
    pub models: Vec<String>,
    pub account: Option<GatewayAccount>,
}

/// Account identity rendered by the settings shell. Display data only.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAccount {
    pub email: String,
    pub org_name: String,
}

fn err_string(e: GatewayError) -> String {
    format!("{}|{e}", e.code())
}

#[tauri::command]
pub async fn gateway_status() -> Result<GatewayStatus, String> {
    let models = catalog::cached_aliases().map_err(err_string)?.unwrap_or_default();
    let account = store::read_account().ok().flatten().map(|a| GatewayAccount {
        email: a.email,
        org_name: a.org_name,
    });
    Ok(GatewayStatus {
        configured: live_key().is_some(),
        proxy_up: proxy_addr().is_some(),
        models,
        account,
    })
}

/// Live model list (validates the key against the gateway). Used at login
/// and for manual refresh. Errors are `CODE|message` for the UI switch.
#[tauri::command]
pub async fn gateway_models() -> Result<Vec<String>, String> {
    catalog::refresh().await.map_err(err_string)
}

/// Store the pasted device key and validate it against the gateway.
/// Shape-checked before any network or keychain write; on validation
/// failure nothing is persisted (no half-logged-in state).
#[tauri::command]
pub async fn gateway_login(key: String) -> Result<Vec<String>, String> {
    let key = key.trim().to_string();
    if !key.starts_with("zn-") || key.len() < 20 {
        return Err("invalid_key|Keys look like zn-… (paste the full value).".to_string());
    }
    store::write_key(&key).map_err(err_string)?;
    set_live_key(key);
    match catalog::refresh().await {
        Ok(aliases) => Ok(aliases),
        Err(e) => {
            // Validation failed: do not keep a bad key anywhere.
            clear_live_key();
            let _ = store::delete_key();
            Err(err_string(e))
        }
    }
}

/// Clear in-memory state only (live key + per-send tokens). Split out so
/// the state transition is unit-testable without touching the keychain;
/// `gateway_logout` adds the keychain delete around this.
pub(crate) fn clear_local_state() {
    clear_live_key();
    if let Ok(mut set) = proxy_tokens().lock() {
        set.clear();
    }
}

/// Log out of the gateway: forget the live key, delete the keychain entry
/// (idempotent), drop per-send proxy tokens. The proxy keeps running but
/// every send fails closed without a live key. Channel-config cleanup
/// (no secrets in it) rides the existing deleteProvider IPC from the UI.
#[tauri::command]
pub async fn gateway_logout() -> Result<(), String> {
    clear_local_state();
    store::delete_key().map_err(err_string)?;
    store::delete_account().map_err(err_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::test_serial;

    #[test]
    fn live_key_roundtrip_and_logout_state() {
        let _g = test_serial();
        assert!(live_key().is_none());
        set_live_key("zn-test".to_string());
        assert!(live_key().is_some());
        proxy_tokens()
            .lock()
            .unwrap()
            .insert("sk-zaino-local-test".to_string());
        clear_local_state();
        assert!(live_key().is_none());
        assert!(proxy_tokens().lock().unwrap().is_empty());
    }

    #[test]
    fn proxy_base_url_tracks_proxy_state() {
        let _g = test_serial();
        // No proxy running in unit tests: sends must fail closed.
        assert!(proxy_base_url().is_none());
        assert!(proxy_channel_env().is_err());
    }
}

/// Test-only global lock: live key + token set are process-global, and
/// Rust runs tests in parallel threads. Any test that mutates them holds
/// this; pure tests (error mapping, catalog parsing, route table) need not.
#[cfg(test)]
pub(crate) fn test_serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    // Poison-tolerant: a panicking test must not fail every test after it.
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Current quota snapshot (spend/cap/age/source). Display only.
#[tauri::command]
pub async fn gateway_quota() -> Result<quota::QuotaSnapshot, String> {
    Ok(quota_snapshot())
}

/// Last mapped gateway failure, if any (banner state on fresh mounts).
#[tauri::command]
pub async fn gateway_last_error() -> Result<Option<GatewayEvent>, String> {
    Ok(last_error())
}

// ── Prompt-based quota (migration 0013) ────────────────────────────────
//
// The portal's /api/device/usage endpoint authenticates with the zn- key
// and returns per-model prompt limits + used counts for the current billing
// period. This is the desktop's only source of prompt-quota truth — the
// old dollar-based QuotaSnapshot stays for backward compat but is no longer
// the primary usage display.

/// Prompt quota snapshot from the portal. Display only; never gates sends.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQuota {
    /// Plan code ("starter", "pro") or null if unknown.
    pub plan_code: Option<String>,
    /// Entitled model aliases for this plan.
    pub models: Vec<String>,
    /// Per-alias prompt limits: {"fast": 500, "smart": 250}.
    pub prompt_limits: std::collections::HashMap<String, u64>,
    /// Per-alias prompts used this billing period.
    pub prompts_used: std::collections::HashMap<String, u64>,
    /// Billing period start (ISO-8601).
    pub period_start: String,
    /// Billing period end (ISO-8601).
    pub period_end: String,
    /// Unix seconds when this snapshot was fetched.
    pub fetched_at: u64,
}

/// Fetch prompt-based quota from the portal using the stored gateway key.
/// Returns None when no key is stored (logged-out state).
async fn fetch_prompt_quota() -> Result<Option<PromptQuota>, GatewayError> {
    let Some(key) = live_key() else {
        return Ok(None);
    };
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| GatewayError::Internal)?;
    let url = format!("{}/api/device/usage", device::PORTAL_BASE_URL);
    let resp = client
        .get(&url)
        .header("authorization", format!("Bearer {}", key.as_str()))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                GatewayError::Unreachable(e.to_string())
            } else {
                GatewayError::Upstream(e.to_string())
            }
        })?;
    let status = resp.status().as_u16();
    if status == 401 {
        // Key invalid or org inactive — treat as logged-out for quota purposes.
        return Ok(None);
    }
    if status != 200 {
        let body = resp.text().await.unwrap_or_default();
        return Err(GatewayError::from_status(status, &body, None));
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        plan_code: Option<String>,
        models: Vec<String>,
        prompt_limits: std::collections::HashMap<String, u64>,
        prompts_by_model: std::collections::HashMap<String, u64>,
        period_start: String,
        period_end: String,
    }
    let raw: Raw = resp.json().await.map_err(|_| GatewayError::Internal)?;
    Ok(Some(PromptQuota {
        plan_code: raw.plan_code,
        models: raw.models,
        prompt_limits: raw.prompt_limits,
        prompts_used: raw.prompts_by_model,
        period_start: raw.period_start,
        period_end: raw.period_end,
        fetched_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    }))
}

/// Prompt-based quota for the current billing period. Display only.
#[tauri::command]
pub async fn gateway_prompt_quota() -> Result<Option<PromptQuota>, String> {
    fetch_prompt_quota().await.map_err(err_string)
}
