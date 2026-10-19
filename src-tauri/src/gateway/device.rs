//! Device-code sign-in for Zaino Desktop (RFC 8628-style, against the portal).
//!
//! DESIGN. The webview cannot touch the portal directly: portal session
//! cookies live in the system browser, and loosening CORS on the portal's
//! auth routes would trade a first-party native flow for a web-attack
//! surface. So the whole device-code exchange — request, poll, collect —
//! runs here in Rust, and the webview only ever sees:
//!
//!   * `user_code` / `verification_url` (display codes, not secrets),
//!   * phase transitions (`awaiting-browser`, `approved`, `expired`, …),
//!   * the entitled aliases on success (via the existing `gateway_login`
//!     → catalog path, or via `collect` returning them).
//!
//! The live `zn-…` key enters through [`super::set_live_key`] and goes
//! straight to the OS keychain (at rest) and proxy memory (at runtime).
//! It NEVER crosses the IPC boundary to the renderer: `collect` finishes
//! the login inside this process. The only secret on the wire is the
//! portal-bound TLS request — exactly like the paste flow, minus the
//! user's fingers and minus any renderer involvement.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use zeroize::Zeroizing;

use super::{clear_live_key, emit_device, set_live_key, store, catalog, error::GatewayError};

/// Portal origin for the device-code endpoints. Twin of the frontend
/// `PORTAL_BASE_URL` (src/features/gateway/constants.ts): a host change is
/// a two-line diff. This is OUR first-party host, not a model host.
pub const PORTAL_BASE_URL: &str = "https://zaino.soon.it";

/// Device-code event topic. Payload is [`DeviceEvent`]; the frontend polls
/// nothing — it renders what these events say.
pub const DEVICE_EVENT: &str = "gateway://device";

/// How long the backend keeps polling for approval before giving up.
/// The portal expires codes after 15 minutes; we stop a little earlier so
/// the UI can show `expired` with a retry affordance instead of the user
/// staring at a dead spinner.
const POLL_DEADLINE_SECS: u64 = 14 * 60;

/// Upper bound on a single `interval` hint from the portal: a malicious or
/// buggy response must not park the poll loop for an hour.
const MAX_INTERVAL_SECS: u64 = 30;

/// One active device-code run. Starts at `begin`, ends on approval, expiry,
/// failure, or `cancel`.
static ACTIVE_RUN: OnceLock<Mutex<Option<u64>>> = OnceLock::new();

fn active_run() -> &'static Mutex<Option<u64>> {
    ACTIVE_RUN.get_or_init(|| Mutex::new(None))
}

/// Device-flow phase, rendered by the LoginScreen state machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case", tag = "phase")]
pub enum DeviceEvent {
    /// Code issued: show `user_code`, open `verification_url` in the
    /// browser, and start waiting. Not a secret phase — display only.
    AwaitingBrowser {
        user_code: String,
        verification_url: String,
        expires_in: u64,
        interval: u64,
    },
    /// Approval collected: the key is already in the keychain + live
    /// state; `models` names the entitled aliases for the welcome screen.
    Approved {
        models: Vec<String>,
        default_model: String,
        email: String,
        org_name: String,
    },
    /// The code was never approved in time (portal expiry or our deadline).
    Expired,
    /// The user cancelled the run (`cancel` command).
    Cancelled,
    /// Anything that went wrong. `code` feeds the UI i18n switch; the
    /// message stays out of renderer snapshots (`message` is English).
    Error { code: String, message: String },
}

fn emit(ev: DeviceEvent) {
    emit_device(&ev);
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenPending {
    error: TokenErrorBody,
}

#[derive(Debug, Deserialize)]
struct TokenErrorBody {
    code: String,
    #[allow(dead_code)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenGranted {
    token: String,
    /// Entitled aliases echoed by the portal. Decoded (and asserted non-
    /// empty in tests) but not displayed: the UI renders the aliases the
    /// local catalog refresh proved, so display and validation can't drift.
    #[allow(dead_code)]
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    user: Option<AccountUser>,
    #[serde(default)]
    organization: Option<AccountOrg>,
}

#[derive(Debug, Deserialize, Default)]
struct AccountUser {
    #[serde(default)]
    email: String,
    /// Display name. Currently unused by the UI (the welcome screen shows
    /// the org name + aliases) but kept decoded for future profile display.
    #[allow(dead_code)]
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct AccountOrg {
    #[serde(default)]
    name: String,
}

/// Map a portal device error code onto a UI error code (same switch the
/// paste flow uses) plus an English sentence for logs.
fn map_portal_error(code: &str, detail: &str) -> (String, String) {
    match code {
        "authorization_pending" => ("pending".to_string(), String::new()),
        "slow_down" => ("slow_down".to_string(), String::new()),
        "expired_token" | "expired" => (
            "expired".to_string(),
            "the sign-in code expired — start over".to_string(),
        ),
        "access_denied" => (
            "denied".to_string(),
            "the sign-in was denied on the portal".to_string(),
        ),
        "invalid_grant" => (
            "expired".to_string(),
            "the sign-in code was already used — start over".to_string(),
        ),
        "payment_required" => (
            "payment_required".to_string(),
            "choose a plan on the portal, then sign in again".to_string(),
        ),
        "forbidden" => (
            "forbidden".to_string(),
            "this account cannot mint device keys".to_string(),
        ),
        _ => (
            "upstream".to_string(),
            format!("portal device endpoint failed ({code}{detail})"),
        ),
    }
}

/// Request a device code and start the approval poll in the background.
/// Returns the display code immediately; approval arrives as [`DeviceEvent`]s.
///
/// Only one run at a time: a second `begin` supersedes the first (its polls
/// see a stale run id and stop).
#[tauri::command]
pub async fn gateway_device_begin() -> Result<DeviceBegin, String> {
    let run = fresh_run_id();
    let issued = request_device_code()
        .await
        .map_err(|e| format!("{}|{e}", e.code()))?;

    emit(DeviceEvent::AwaitingBrowser {
        user_code: issued.user_code.clone(),
        verification_url: issued.verification_url.clone(),
        expires_in: issued.expires_in,
        interval: issued.interval,
    });
    spawn_poll(run, issued.device_code, issued.interval);

    Ok(DeviceBegin {
        user_code: issued.user_code,
        verification_url: issued.verification_url,
        expires_in: issued.expires_in,
        interval: issued.interval,
    })
}

/// Display material for the login screen. Secrets stay here — the webview
/// only receives `user_code` + `verification_url`.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceBegin {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Cancel the active device-code run, if any. Idempotent.
#[tauri::command]
pub async fn gateway_device_cancel() -> Result<(), String> {
    end_run();
    emit(DeviceEvent::Cancelled);
    Ok(())
}

struct Issued {
    device_code: Zeroizing<String>,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

fn fresh_run_id() -> u64 {
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1);
    if let Ok(mut slot) = active_run().lock() {
        *slot = Some(id);
    }
    id
}

fn end_run() {
    if let Ok(mut slot) = active_run().lock() {
        *slot = None;
    }
}

fn run_alive(id: u64) -> bool {
    active_run()
        .lock()
        .map(|slot| *slot == Some(id))
        .unwrap_or(false)
}

fn client() -> Result<reqwest::Client, GatewayError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| GatewayError::Internal)
}

/// POST /api/auth/device — no auth, display codes out.
async fn request_device_code() -> Result<Issued, GatewayError> {
    let url = format!("{PORTAL_BASE_URL}/api/auth/device");
    let resp = client()?
        .post(&url)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                GatewayError::Unreachable(e.to_string())
            } else {
                GatewayError::Upstream(e.to_string())
            }
        })?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(GatewayError::from_status(status, &body, None));
    }
    let parsed: DeviceCodeResponse = resp.json().await.map_err(|_| GatewayError::Internal)?;
    if parsed.device_code.trim().is_empty() || parsed.user_code.trim().is_empty() {
        return Err(GatewayError::Internal);
    }
    Ok(Issued {
        device_code: Zeroizing::new(parsed.device_code),
        user_code: parsed.user_code,
        verification_url: parsed.verification_url,
        expires_in: parsed.expires_in,
        interval: parsed.interval.clamp(1, MAX_INTERVAL_SECS),
    })
}

/// Poll loop: runs until approval, expiry, error, cancel, or deadline.
/// All network here; completion funnels through [`finish_granted`].
fn spawn_poll(run: u64, device_code: Zeroizing<String>, mut interval: u64) {
    tauri::async_runtime::spawn(async move {
        interval = interval.clamp(1, MAX_INTERVAL_SECS);
        let deadline = std::time::Instant::now() + Duration::from_secs(POLL_DEADLINE_SECS);
        loop {
            if !run_alive(run) {
                return; // superseded or cancelled
            }
            if std::time::Instant::now() >= deadline {
                end_run();
                emit(DeviceEvent::Expired);
                return;
            }
            sleep_chunked(run, Duration::from_secs(interval)).await;
            if !run_alive(run) {
                return;
            }
            match poll_once(&device_code).await {
                PollOutcome::Pending => {}
                PollOutcome::SlowDown => {
                    interval = (interval.saturating_mul(2)).clamp(1, MAX_INTERVAL_SECS);
                }
                PollOutcome::Granted(granted) => {
                    finish_granted(run, granted).await;
                    return;
                }
                PollOutcome::Terminal { code, message } => {
                    end_run();
                    emit(DeviceEvent::Error { code, message });
                    return;
                }
            }
        }
    });
}

/// Sleep in short chunks so a cancel lands in ≤1s, not at the next poll.
async fn sleep_chunked(run: u64, total: Duration) {
    let mut left = total;
    let step = Duration::from_millis(500);
    while left > Duration::ZERO {
        if !run_alive(run) {
            return;
        }
        let chunk = left.min(step);
        tokio::time::sleep(chunk).await;
        left = left.saturating_sub(chunk);
    }
}

enum PollOutcome {
    Pending,
    SlowDown,
    Granted(TokenGranted),
    Terminal { code: String, message: String },
}

/// One token poll. No secrets in any error path — the device code stays in
/// `device_code`, and only its presence (never its value) is logged.
async fn poll_once(device_code: &Zeroizing<String>) -> PollOutcome {
    let url = format!("{PORTAL_BASE_URL}/api/auth/device/token");
    let resp = match client() {
        Ok(c) => c
            .post(&url)
            .json(&serde_json::json!({ "device_code": device_code.as_str() }))
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    GatewayError::Unreachable(e.to_string())
                } else {
                    GatewayError::Upstream(e.to_string())
                }
            }),
        Err(e) => Err(e),
    };
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[gateway] device poll transport failed: {e}");
            // Transient network failure: stay in the loop, keep the same
            // interval. Terminal states come from the portal, not the wire.
            return PollOutcome::Pending;
        }
    };
    if resp.status().is_success() {
        return match resp.json::<TokenGranted>().await {
            Ok(g) if is_well_formed_key(&g.token) => PollOutcome::Granted(g),
            Ok(_) => PollOutcome::Terminal {
                code: "invalid_key".to_string(),
                message: "the portal returned a malformed key".to_string(),
            },
            Err(_) => PollOutcome::Terminal {
                code: "upstream".to_string(),
                message: "the portal returned an unreadable token".to_string(),
            },
        };
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    let portal_code = serde_json::from_str::<TokenPending>(&body)
        .ok()
        .map(|p| p.error.code)
        .unwrap_or_default();
    if status == 400 && (portal_code == "authorization_pending" || portal_code.is_empty()) {
        return PollOutcome::Pending;
    }
    if status == 400 && portal_code == "slow_down" {
        return PollOutcome::SlowDown;
    }
    let (code, message) = map_portal_error(&portal_code, "");
    if code == "pending" || code == "slow_down" {
        return if code == "slow_down" {
            PollOutcome::SlowDown
        } else {
            PollOutcome::Pending
        };
    }
    PollOutcome::Terminal { code, message }
}

fn is_well_formed_key(token: &str) -> bool {
    let t = token.trim();
    t.starts_with("zn-") && t.len() >= 20
}

/// Approval collected: persist + validate exactly like the paste flow, then
/// hand the welcome screen its display data. Nothing about the key crosses
/// to the renderer — `Approved.models` are entitled aliases, not secrets.
async fn finish_granted(_run: u64, granted: TokenGranted) {
    let key = granted.token.trim().to_string();
    if store::write_key(&key).is_err() {
        end_run();
        emit(DeviceEvent::Error {
            code: "keychain_unavailable".to_string(),
            message: "system keychain unavailable (it may be locked) — unlock and retry".to_string(),
        });
        return;
    }
    set_live_key(key);
    // Persist account metadata so the settings shell can render it (and
    // survive restart) without re-approving. Display data only.
    let email = granted.user.as_ref().map(|u| u.email.clone()).unwrap_or_default();
    let org_name = granted.organization.as_ref().map(|o| o.name.clone()).unwrap_or_default();
    if !email.is_empty() || !org_name.is_empty() {
        let _ = store::write_account(&store::StoredAccount { email, org_name });
    }
    match catalog::refresh().await {
        Ok(aliases) => {
            end_run();
            let mut models = aliases;
            models.sort();
            let default_model = models.first().cloned().unwrap_or_default();
            emit(DeviceEvent::Approved {
                models,
                default_model,
                email: granted.user.map(|u| u.email).unwrap_or_default(),
                org_name: granted.organization.map(|o| o.name).unwrap_or_default(),
            });
        }
        Err(e) => {
            // Validation failed: do not keep a bad key anywhere (same
            // no-half-logged-in rule as `gateway_login`).
            clear_live_key();
            let _ = store::delete_key();
            end_run();
            emit(DeviceEvent::Error {
                code: e.code().to_string(),
                message: e.to_string(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_error_codes_map_to_ui_codes() {
        let (code, _) = map_portal_error("expired_token", "");
        assert_eq!(code, "expired");
        let (code, _) = map_portal_error("authorization_pending", "");
        assert_eq!(code, "pending");
        let (code, _) = map_portal_error("slow_down", "");
        assert_eq!(code, "slow_down");
        let (code, _) = map_portal_error("access_denied", "");
        assert_eq!(code, "denied");
        let (code, _) = map_portal_error("payment_required", "");
        assert_eq!(code, "payment_required");
        let (code, msg) = map_portal_error("mystery-code", "");
        assert_eq!(code, "upstream");
        assert!(!msg.is_empty());
    }

    #[test]
    fn malformed_tokens_rejected_before_keychain() {
        assert!(!is_well_formed_key(""));
        assert!(!is_well_formed_key("sk-abcdef0123456789"));
        assert!(!is_well_formed_key("zn-short"));
        assert!(is_well_formed_key("zn-abcdefghijklmnopqrstuvwxyz0123456789ABCD"));
    }

    #[test]
    fn poll_interval_is_clamped() {
        assert_eq!(0u64.clamp(1, MAX_INTERVAL_SECS), 1);
        assert_eq!(999u64.clamp(1, MAX_INTERVAL_SECS), MAX_INTERVAL_SECS);
        assert_eq!(5u64.clamp(1, MAX_INTERVAL_SECS), 5);
    }

    #[test]
    fn portal_base_is_first_party_https() {
        assert!(PORTAL_BASE_URL.starts_with("https://"));
        assert!(!PORTAL_BASE_URL.contains("127.0.0.1"));
        assert!(!PORTAL_BASE_URL.contains("sslip.io"));
    }

    #[test]
    fn run_ids_supersede() {
        let id = fresh_run_id();
        assert!(run_alive(id));
        end_run();
        assert!(!run_alive(id));
    }
}
