//! Model catalog: entitled aliases from the gateway, cached without secrets.
//!
//! The gateway's `GET /v1/models` is entitlement-filtered per key
//! (verified live: a fast-only key sees `['fast']`), so the returned list
//! IS the entitled set — no client-side plan logic, ever. Only model ids
//! are cached (plus a timestamp); the key never touches this file.
//!
//! Parsing and checking are pure functions (unit-tested); the thin IO
//! wrappers below own the filesystem.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{live_key, GATEWAY_BASE_URL};
use crate::gateway::error::GatewayError;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CatalogCache {
    aliases: Vec<String>,
    fetched_at: u64,
}

fn cache_path() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".ccgui-next").join("gateway-models.json"))
}

// `dirs::home_dir` equivalent without adding a dependency: the codebase
// already steers HOME/USERPROFILE in tests via `crate::paths`.
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn gateway_order_sort(aliases: &mut Vec<String>) {
    let order = ["fast", "smart", "frontier"];
    aliases.sort_by_key(|a| {
        let lower = a.to_lowercase();
        order.iter().position(|&o| o == lower).unwrap_or(99)
    });
}

/// Parse + normalize cached bytes. `None` = missing/corrupt/empty →
/// caller treats as "never fetched" (re-login), never an error.
pub fn parse_cache(raw: &str) -> Option<Vec<String>> {
    let mut aliases = serde_json::from_str::<CatalogCache>(raw).ok()?.aliases;
    gateway_order_sort(&mut aliases);
    aliases.dedup();
    (!aliases.is_empty()).then_some(aliases)
}

/// First alias alphabetically — the channel default model.
pub fn default_of(aliases: &[String]) -> Option<String> {
    aliases.iter().min().cloned()
}

/// Validate a requested model against the entitled set for one send.
/// Fail-closed: unlisted model = send refused with the entitled list,
/// never a silent gateway 403 the user cannot act on.
pub fn check_model(requested: Option<&str>, aliases: &[String]) -> Result<String, GatewayError> {
    let want = requested
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| default_of(aliases));
    match want {
        Some(m) if aliases.iter().any(|a| a == &m) => Ok(m),
        Some(m) => Err(GatewayError::ModelBlocked { model: m }),
        None => Err(GatewayError::NotConfigured),
    }
}

/// Read cached aliases. `Ok(None)` = never fetched (login required).
pub fn cached_aliases() -> Result<Option<Vec<String>>, GatewayError> {
    let Some(path) = cache_path() else {
        return Ok(None);
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(parse_cache(&raw)),
        Err(_) => Ok(None),
    }
}

/// First cached alias, or `None`.
pub fn default_alias() -> Option<String> {
    cached_aliases().ok().flatten().and_then(|a| default_of(&a))
}

/// Validate the key against the live gateway and refresh the cache.
/// Returns the entitled aliases. Every failure maps to a UI state
/// (401 → re-login, unreachable → offline) — never panics, never logs
/// the key.
pub async fn refresh() -> Result<Vec<String>, GatewayError> {
    let Some(key) = live_key() else {
        return Err(GatewayError::NotConfigured);
    };
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| GatewayError::Internal)?;
    let resp = client
        .get(format!("{GATEWAY_BASE_URL}/v1/models"))
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
    if status != 200 {
        let body = resp.text().await.unwrap_or_default();
        return Err(GatewayError::from_status(status, &body, None));
    }
    let data: serde_json::Value = resp.json().await.map_err(|_| GatewayError::Internal)?;
    let mut aliases: Vec<String> = data
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    gateway_order_sort(&mut aliases);
    aliases.dedup();
    if aliases.is_empty() {
        // Valid key, zero entitlement: distinct from every failure above.
        // The UI explains "no models on your plan" instead of "login failed".
        return Err(GatewayError::NoModelsEntitled);
    }
    if let Some(path) = cache_path() {
        let cache = CatalogCache {
            aliases: aliases.clone(),
            fetched_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        // Best effort: a cache write failure must not fail the login.
        let _ = std::fs::write(&path, serde_json::to_string(&cache).unwrap_or_default());
    }
    Ok(aliases)
}

/// Validate a requested model against the cached entitled set.
pub fn checked_model(requested: Option<&str>) -> Result<String, GatewayError> {
    let cached = cached_aliases().map_err(|_| GatewayError::Internal)?;
    let Some(aliases) = cached else {
        return Err(GatewayError::NotConfigured);
    };
    check_model(requested, &aliases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_cache_is_none() {
        assert_eq!(parse_cache(""), None);
        assert_eq!(parse_cache("{{{corrupt"), None);
        assert_eq!(parse_cache(r#"{"aliases":[]}"#), None);
    }

    #[test]
    fn parses_and_normalizes() {
        let got = parse_cache(r#"{"aliases":["smart","fast","fast"],"fetched_at":1}"#).unwrap();
        assert_eq!(got, vec!["fast".to_string(), "smart".to_string()]);
    }

    #[test]
    fn default_is_first_alphabetical() {
        let a = vec!["smart".to_string(), "fast".to_string()];
        assert_eq!(default_of(&a).as_deref(), Some("fast"));
        let empty: Vec<String> = vec![];
        assert_eq!(default_of(&empty), None);
    }

    #[test]
    fn check_model_fail_closed() {
        let a = vec!["fast".to_string()];
        assert_eq!(check_model(Some("fast"), &a).unwrap(), "fast");
        assert_eq!(check_model(None, &a).unwrap(), "fast");
        assert_eq!(check_model(Some("  "), &a).unwrap(), "fast");
        match check_model(Some("opus"), &a) {
            Err(GatewayError::ModelBlocked { model }) => assert_eq!(model, "opus"),
            other => panic!("wrong variant: {other:?}"),
        }
        let empty: Vec<String> = vec![];
        assert!(matches!(
            check_model(None, &empty),
            Err(GatewayError::NotConfigured)
        ));
    }
}
