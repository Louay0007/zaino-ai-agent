//! Failure vocabulary for the gateway path.
//!
//! Backend-shaped, frontend-rendered: variants carry machine-readable codes
//! plus the one human sentence the UI needs. No key material, no request
//! bodies, no upstream internals — the UI must never have to parse a
//! message to decide what happened.

use std::fmt;

/// Machine-readable gateway outcome. The frontend maps `code()` to i18n
/// strings; `message()` is the English fallback / log line.
#[derive(Debug, Clone)]
pub enum GatewayError {
    /// No key stored (fresh install or logged out).
    NotConfigured,
    /// OS store unreachable (locked, missing daemon, denied).
    KeychainUnavailable(String),
    /// Proxy loopback server is down. Sends fail — never direct-connect.
    ProxyDown,
    /// The stored key was rejected (401): wrong, expired, or revoked.
    Unauthorized,
    /// The model is not in this key's allowlist (403).
    ModelBlocked { model: String },
    /// Budget exhausted (429 `budget_exceeded`, no retry-after by design).
    BudgetExhausted { spend: Option<f64>, cap: Option<f64> },
    /// Gateway-side rate limit with a wait hint (429 + retry-after).
    RateLimited { retry_after_secs: Option<u64> },
    /// The key is valid but entitled to zero models (distinct from every
    /// failure above — the UI explains "no models on your plan").
    NoModelsEntitled,
    /// Upstream/provider failure surfaced by the gateway (5xx, timeouts,
    /// `No deployments available`).
    Upstream(String),
    /// Proxy could not reach the gateway at all (DNS/TLS/connect).
    Unreachable(String),
    /// Anything else (serde, IO, lock poisoning). Message only.
    Internal,
}

impl GatewayError {
    /// Stable snake_case code for the UI switch + tests.
    pub fn code(&self) -> &'static str {
        match self {
            GatewayError::NotConfigured => "not_configured",
            GatewayError::KeychainUnavailable(_) => "keychain_unavailable",
            GatewayError::ProxyDown => "proxy_down",
            GatewayError::Unauthorized => "unauthorized",
            GatewayError::ModelBlocked { .. } => "model_blocked",
            GatewayError::BudgetExhausted { .. } => "budget_exhausted",
            GatewayError::RateLimited { .. } => "rate_limited",
            GatewayError::NoModelsEntitled => "no_models_entitled",
            GatewayError::Upstream(_) => "upstream_error",
            GatewayError::Unreachable(_) => "unreachable",
            GatewayError::Internal => "internal",
        }
    }

    /// Map an HTTP status + LiteLLM error body onto an outcome.
    /// Rule (matches the gateway's contract, verified 2026-10-16):
    /// branch on `error.type`, never on hint text; a 429 WITHOUT
    /// retry-after and WITH budget signal is exhaustion, not throttling.
    pub fn from_status(status: u16, body: &str, retry_after: Option<u64>) -> Self {
        let err_type = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("error")?.get("type")?.as_str().map(str::to_string))
            .unwrap_or_default();
        match status {
            401 => GatewayError::Unauthorized,
            403 => {
                let model = serde_json::from_str::<serde_json::Value>(body)
                    .ok()
                    .and_then(|v| {
                        v.get("error")?
                            .get("param")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "unknown".to_string());
                GatewayError::ModelBlocked { model }
            }
            429 if err_type == "budget_exceeded" => {
                let (spend, cap) = parse_budget_figures(body);
                GatewayError::BudgetExhausted { spend, cap }
            }
            429 if err_type == "throttling_error" || retry_after.is_some() => {
                GatewayError::RateLimited {
                    retry_after_secs: retry_after,
                }
            }
            // A 429 that is neither budget-typed nor throttling-typed is
            // treated as exhaustion: the safe direction (never retry-loop
            // a customer into a bigger bill).
            429 => GatewayError::BudgetExhausted {
                spend: None,
                cap: None,
            },
            s if (500..600).contains(&s) => {
                GatewayError::Upstream(format!("gateway answered {s}"))
            }
            _ => GatewayError::Upstream(format!("gateway answered {status}")),
        }
    }
}

/// Best-effort extraction of `Current cost: X, Max budget: Y` from a
/// `budget_exceeded` message body. Figures are display-only.
fn parse_budget_figures(body: &str) -> (Option<f64>, Option<f64>) {
    fn after(body: &str, label: &str) -> Option<f64> {
        let rest = body.split(label).nth(1)?;
        let num: String = rest
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        num.parse::<f64>().ok()
    }
    (after(body, "Current cost:"), after(body, "Max budget:"))
}

impl fmt::Display for GatewayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GatewayError::NotConfigured => write!(f, "no gateway key stored"),
            GatewayError::KeychainUnavailable(e) => write!(f, "keychain unavailable: {e}"),
            GatewayError::ProxyDown => write!(f, "gateway proxy is not running"),
            GatewayError::Unauthorized => write!(f, "gateway key rejected (401)"),
            GatewayError::ModelBlocked { model } => {
                write!(f, "model not in plan allowlist: {model}")
            }
            GatewayError::BudgetExhausted { spend, cap } => {
                write!(f, "budget exhausted (spend={spend:?}, cap={cap:?})")
            }
            GatewayError::RateLimited { retry_after_secs } => {
                write!(f, "rate limited (retry_after={retry_after_secs:?})")
            }
            GatewayError::NoModelsEntitled => {
                write!(f, "no models entitled to this key")
            }
            GatewayError::Upstream(e) => write!(f, "upstream error: {e}"),
            GatewayError::Unreachable(e) => write!(f, "gateway unreachable: {e}"),
            GatewayError::Internal => write!(f, "internal gateway error"),
        }
    }
}

impl std::error::Error for GatewayError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unauthorized_on_401() {
        let e = GatewayError::from_status(401, r#"{"error":{"type":"auth_error"}}"#, None);
        assert!(matches!(e, GatewayError::Unauthorized));
        assert_eq!(e.code(), "unauthorized");
    }

    #[test]
    fn budget_exhausted_with_figures() {
        let body = r#"{"error":{"type":"budget_exceeded","message":"Budget has been exceeded! Current cost: 0.06, Max budget: 0.05"}}"#;
        match GatewayError::from_status(429, body, None) {
            GatewayError::BudgetExhausted { spend, cap } => {
                assert_eq!(spend, Some(0.06));
                assert_eq!(cap, Some(0.05));
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn throttling_with_retry_after() {
        let body = r#"{"error":{"type":"throttling_error"}}"#;
        match GatewayError::from_status(429, body, Some(30)) {
            GatewayError::RateLimited { retry_after_secs } => {
                assert_eq!(retry_after_secs, Some(30));
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn bare_429_is_exhaustion_not_throttle() {
        // The safe direction: never retry-loop a customer into a bill.
        let e = GatewayError::from_status(429, "{}", None);
        assert!(matches!(e, GatewayError::BudgetExhausted { .. }));
    }

    #[test]
    fn model_blocked_carries_model() {
        let body = r#"{"error":{"type":"key_model_access_denied","param":"frontier"}}"#;
        match GatewayError::from_status(403, body, None) {
            GatewayError::ModelBlocked { model } => assert_eq!(model, "frontier"),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn five_hundred_is_upstream() {
        let e = GatewayError::from_status(503, "{}", None);
        assert!(matches!(e, GatewayError::Upstream(_)));
    }

    #[test]
    fn no_models_entitled_has_own_code() {
        assert_eq!(GatewayError::NoModelsEntitled.code(), "no_models_entitled");
    }
}
