//! Quota snapshot: spend vs cap for the meter, from gateway truth only.
//!
//! Display data, never a gate: nothing here permits or refuses a send.
//! Sources, in priority order:
//!   1. Response headers on real traffic (`x-litellm-key-spend`,
//!      `x-litellm-key-max-budget`) — authoritative figures, verified live
//!      on LiteLLM v1.103.1 (non-streaming responses only; streams carry no
//!      cost headers).
//!   2. Budget-429 bodies (`Current cost / Max budget`) — authoritative at
//!      the moment of exhaustion; also sets the blocked flag.
//!   3. Local token estimate (nominal rates × counted tokens) — labeled
//!      `estimate`, used only when no authoritative figure ever arrived.
//! Uploaded through `gateway_quota`; rendered with age ("as of HH:MM") and
//! an `unknown` state when nothing is known yet — never a fake zero.

use serde::{Deserialize, Serialize};

/// Nominal per-Mtok rates, mirroring the gateway's single price row
/// (all aliases share them today). ESTIMATE ONLY — the ledger and the
/// gateway disagree on purpose; this number never leaves the UI.
pub const NOMINAL_INPUT_PER_MTOK: f64 = 0.15;
pub const NOMINAL_OUTPUT_PER_MTOK: f64 = 0.60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaSource {
    Headers,
    BudgetError,
    Estimate,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaSnapshot {
    pub spend: Option<f64>,
    pub cap: Option<f64>,
    /// Unix seconds of the last authoritative update (headers or 429 body).
    /// Estimates do not refresh this — stale age must stay honest.
    pub fetched_at: Option<u64>,
    pub source: QuotaSource,
    /// Unix seconds of the last budget-exhaustion observed, if any.
    pub blocked_at: Option<u64>,
}

impl Default for QuotaSnapshot {
    fn default() -> Self {
        QuotaSnapshot {
            spend: None,
            cap: None,
            fetched_at: None,
            source: QuotaSource::Unknown,
            blocked_at: None,
        }
    }
}

impl QuotaSnapshot {
    /// Usage ratio 0.0–1.0+ when both figures are known.
    pub fn ratio(&self) -> Option<f64> {
        match (self.spend, self.cap) {
            (Some(s), Some(c)) if c > 0.0 => Some(s / c),
            _ => None,
        }
    }

    /// Soft-limit tripped at 80%: banner, traffic continues.
    pub fn soft_tripped(&self) -> bool {
        matches!(self.ratio(), Some(r) if r >= 0.8)
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Fold `x-litellm-key-spend` / `x-litellm-key-max-budget` response headers
/// into the snapshot. Returns true when anything changed.
pub fn record_headers(snapshot: &mut QuotaSnapshot, get: impl Fn(&str) -> Option<String>) -> bool {
    let parse = |v: Option<String>| v.and_then(|s| s.trim().parse::<f64>().ok());
    let spend = parse(get("x-litellm-key-spend"));
    let cap = parse(get("x-litellm-key-max-budget"));
    if spend.is_none() && cap.is_none() {
        return false;
    }
    if spend.is_some() {
        snapshot.spend = spend;
    }
    if cap.is_some() {
        snapshot.cap = cap;
    }
    snapshot.fetched_at = Some(now_secs());
    snapshot.source = QuotaSource::Headers;
    true
}

/// Fold a budget-429 body into the snapshot and mark blocked. The figures
/// in the message are authoritative at exhaustion time.
pub fn record_budget_error(snapshot: &mut QuotaSnapshot, spend: Option<f64>, cap: Option<f64>) {
    if spend.is_some() {
        snapshot.spend = spend;
    }
    if cap.is_some() {
        snapshot.cap = cap;
    }
    snapshot.fetched_at = Some(now_secs());
    snapshot.source = QuotaSource::BudgetError;
    snapshot.blocked_at = Some(now_secs());
}

/// Token-count estimate at nominal rates. Labeled as such — only used when
/// no authoritative figure exists (streaming-only usage).
pub fn estimate_cost(input_tokens: u64, output_tokens: u64) -> f64 {
    (input_tokens as f64) * NOMINAL_INPUT_PER_MTOK / 1_000_000.0
        + (output_tokens as f64) * NOMINAL_OUTPUT_PER_MTOK / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers<'a>(pairs: &'a [(&str, &str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name: &str| {
            pairs
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn records_spend_and_cap_with_timestamp() {
        let mut s = QuotaSnapshot::default();
        let h = headers(&[
            ("x-litellm-key-spend", "0.001"),
            ("x-litellm-key-max-budget", "1.0"),
        ]);
        assert!(record_headers(&mut s, h));
        assert_eq!(s.spend, Some(0.001));
        assert_eq!(s.cap, Some(1.0));
        assert_eq!(s.source, QuotaSource::Headers);
        assert!(s.fetched_at.is_some());
        assert!(!s.soft_tripped());
    }

    #[test]
    fn ignores_responses_without_quota_headers() {
        let mut s = QuotaSnapshot::default();
        assert!(!record_headers(&mut s, headers(&[("content-type", "x")])));
        assert_eq!(s.source, QuotaSource::Unknown);
    }

    #[test]
    fn partial_updates_keep_the_other_figure() {
        let mut s = QuotaSnapshot::default();
        record_headers(&mut s, headers(&[("x-litellm-key-spend", "0.5")]));
        record_headers(&mut s, headers(&[("x-litellm-key-max-budget", "2.0")]));
        assert_eq!(s.spend, Some(0.5));
        assert_eq!(s.cap, Some(2.0));
    }

    #[test]
    fn budget_error_marks_blocked_with_figures() {
        let mut s = QuotaSnapshot::default();
        record_budget_error(&mut s, Some(0.06), Some(0.05));
        assert_eq!(s.source, QuotaSource::BudgetError);
        assert!(s.blocked_at.is_some());
        assert!(s.soft_tripped());
    }

    #[test]
    fn estimate_uses_nominal_rates() {
        // 1M in + 1M out at 0.15/0.60 = $0.75. Labeled estimate, UI-only.
        assert!((estimate_cost(1_000_000, 1_000_000) - 0.75).abs() < 1e-9);
    }
}
