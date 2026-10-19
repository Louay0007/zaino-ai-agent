# Phase 3 — Detailed Design & Plan: Zaino Desktop (ccgui fork)

- Status: **PROPOSED — awaiting your approval. No implementation until you say "approved".**
- Decides nothing already decided in `02-adr.md` (custody = hybrid/proxy). This doc designs it.
- Defaults used where Q1–Q7 are unanswered (each tagged **DEFAULT**, all overridable without redesign — the plan is built to survive them):
  - App: **Zaino Desktop**, bundle id `ai.zaino.desktop` (DEFAULT for Q1; keep MIT notice).
  - OS: macOS-first, architecture covers all three (DEFAULT for Q2).
  - Portal login M1: **browser-issued per-device key, paste-once** — zero portal changes (DEFAULT for Q3; proper OAuth = M7).
  - Keys: long-lived per-device revocable `zn-…` keys (current backend; DEFAULT for Q4).
  - Quota: gateway response headers + local ledger; no new backend work (DEFAULT for Q5).
  - Updates: self-hosted `latest.json` + new minisign key (DEFAULT for Q6).
  - Bridge/relay/telemetry/market/skills-hub/presets: **all disabled in v1** (DEFAULT for Q7).
- Labels: **VERIFIED** (read/probed), **ASSUMPTION**, **UNVERIFIED** (must be probed in its milestone).

---

## 1. Auth: flow, lifecycle, storage, logout, multi-device, offline

### 1.1 M1 login flow (no portal changes)

The portal already mints per-key API keys with names, budgets, and model allowlists through its Keys page (VERIFIED `portal/lib/keys/`, dashboard `/dashboard/keys`). M1 reuses that UI as the device-enrollment page — the desktop just orchestrates it.

```
User            Zaino Desktop (Tauri)              System browser              Portal (web)                Gateway (LiteLLM)
 |                    |                                 |                          |                              |
 |--Sign in---------->|                                 |                          |                              |
 |                    |--openUrl(portal /keys ---------->|                          |                              |
 |                    |   + ?device=<name>)             |                          |                              |
 |                    |                                 |--login (existing Auth.js)->|                             |
 |                    |                                 |<-------keys page------------|                              |
 |                    |<-----user pastes zn-… key--------|                          |                              |
 |                    |--GET /v1/models (Bearer key)---->|                          |---validate + allowlist----->|
 |                    |<-------200 ["fast",...]----------|                          |                              |
 |                    |--keyring store (service=ai.zaino.desktop, user=device-id)  |                              |
 |                    |--GET /v1/models → model picker--|                          |                              |
 |                    |--one Claude chat--------------->|                          |---translate → upstream----->|
 |<--stream renders----|                                 |                          |                              |
```

Why paste-once and not fancier: S3 pattern from Phase 1 (proven by `gh`, Requesty, OpenRouter); no portal work; key never touches shell history (paste into a password field, never `export`). Validation before storage: `GET /v1/models` must 200 and return a non-empty list — an empty list means "key valid but entitled to nothing" and is a distinct, explained state (not "login failed").

Device identity: `device-id = <os>-<hostname-hash8>` (e.g. `macos-9f3a1c2e`), suggested as the key name in the browser URL (`?device=` prefills the portal's key-name field — portal change NOT required; if the portal ignores the param, the user types it; document both). Multi-device = multi-key by construction; portal revokes per device (existing UI).

### 1.2 Token lifecycle (M1 keys; M7 OAuth when approved)

| Phase | Credential | Lifetime | Refresh | Revocation |
|---|---|---|---|---|
| M1–M6 | Long-lived per-device `zn-…` Bearer key | Until revoked; budgets bound server-side | None — re-paste on 401 (explicit UX, not silent) | Portal Keys page (user) + desktop logout (local wipe + revoke call when portal auth exists; until M7, logout opens the portal revoke page AND deletes locally — honest two-step, labeled as such) |
| M7 (deferred) | OAuth access (short) + refresh (rotating) | Minutes / sliding | Proxy exchanges refresh via portal token endpoint; CLI sessions never notice | `revoke` + family invalidation per RFC 7009/9700 |

Storage (all milestones): OS keychain via `keyring` 4.2.0 (`service="ai.zaino.desktop"`, `user=device-id`). Serialize access (one mutex — keyring docs: no reliable concurrent sane behavior, VERIFIED 01-b). In-memory: single `RwLock<Option<KeyMaterial>>` in the proxy, zeroized on drop. **Never**: webview, IPC payload, logs, `config.json`, native CLI files, child env (children get dummy `sk-zaino-local-dummy`).

### 1.3 Logout (hard req. 3 — tested, not claimed)

`gateway logout` performs, in order: (1) proxy refuses new sends (drain ≤5s, abort streams); (2) keychain `delete_credential` + zeroize memory + confirm deletion (re-read must be `NoEntry`); (3) server-side revoke — M1: open portal Keys page deep link AND mark local state `revoked-pending` with copy explaining the click; M7+: direct revoke call; (4) remove every file the app wrote (registration TOMLs/JSONs, proxy port file if any); (5) post-logout assertion: recursive scan of all written paths for `zn-` pattern → must be empty, else loud failure. Logout is per-device; other devices' keys untouched (this is WHY per-device keys, not one account key).

### 1.4 Offline / expired / revoked handling

- No network at send time → `OFFLINE` state before any credential use (fail fast, no key access needed).
- HTTP 401 from gateway → key invalid/expired/revoked: state `RE_AUTH`, keep cached model list marked stale, single "Sign in again" action (re-paste). Never retry-loop 401.
- HTTP 403 `key_model_access_denied` → model fell out of entitlement: drop it from picker, explain, offer entitled remainder (no dead ends).
- Budget 429 → hard block (see §3). Rate 429 with `retry-after` → bounded wait + retry (see §3).
- First launch with keychain `NoEntry` → login screen (normal). `NoStorageAccess`/`PlatformFailure` → unlock-guidance + retry → re-login path (01-b table).

---

## 2. Gateway client module

New Rust module `src-tauri/src/gateway/` (hard req. 4 — no engine-file edits):

| File | Responsibility |
|---|---|
| `gateway/mod.rs` | Registration, `GatewayState` (keychain handle, proxy handle, catalog cache, quota snapshot), fail-closed send gate |
| `gateway/store.rs` | Keychain CRUD (mutex-serialized), in-memory zeroizing holder, logout wipe + assertion scan |
| `gateway/proxy.rs` | Loopback axum server: `127.0.0.1`, ephemeral port, per-launch path token; forwards `POST /v1/{chat/completions,messages,responses}`, `GET /v1/models`; injects real Bearer; streams SSE unbuffered; strips upstream-identifying response headers (`x-litellm-model-name`, `-model-id`, `-api-base` — alias invariant); enforces timeout exclusions on stream routes |
| `gateway/catalog.rs` | `GET /v1/models` with real key (Rust-side only), returns alias ids to UI; cache `{aliases, fetched_at}` (persist ids only — no secrets); stale >24h or any 401/403/429 = refetch; **entitlement filtering is the gateway's answer, never client logic** (VERIFIED live: fast-only key sees `['fast']`) |
| `gateway/quota.rs` | Quota snapshot `{spend, cap, reset_hint, fetched_at, source}` from (a) opportunistic `x-litellm-key-spend`/`x-litellm-key-max-budget` response headers (authoritative figures, VERIFIED live), (b) local token ledger × nominal rates as labeled estimate for streaming turns, (c) portal polling post-M7. Display-only: NEVER gates sends |
| `gateway/error.rs` | Maps gateway outcomes → UI states (table below); mid-stream SSE `data:{"error":…}` scanned per chunk |
| `gateway/channels.rs` | ~~Registration writers per engine schema~~ — REMOVED post-M2 with the M3 cancellation (Zaino-only scope). Claude needs no files (env-pointer injection); nothing else is onboarded. |

Frontend `src/features/gateway/`: `useGateway()` hook (status, models, quota, actions), login screen, quota meter, blocked states. IPC surface (Rust→webview only, never key material): `gateway_status`, `gateway_models`, `gateway_quota`, `gateway_login{key}`, `gateway_logout`, `gateway_open_portal{page}`.

**Error → UI mapping (authoritative for all engines):**

| Gateway outcome | UI state | Behavior |
|---|---|---|
| 200 (+ headers) | `ok` | Update spend snapshot opportunistically |
| 401 (`token_not_found`/`expired_key`/`auth_error`) | `re_auth` | Stop, keep stale cache labeled, single re-login action. No retries |
| 403 (`key_model_access_denied`) | `model_blocked` | Remove model from picker, explain scope, suggest entitled alternative |
| 429 `budget_exceeded` (no retry-after — VERIFIED shape) | `hard_blocked` | Blocking screen: spend vs cap figures, "resets with billing period", upgrade link to portal billing. No retries, ever |
| 429 `throttling_error` + `retry-after` | `waiting` | Bounded wait (header + jitter, ≤3 tries) then surface; progress shown, cancellable |
| 429 without body signals | `hard_blocked` (assume budget — the safe direction) | Same as budget; note assumption in diagnostics |
| 5xx / `No deployments available` / timeout / offline | `degraded` | Exp backoff + jitter, ≤3 tries, then error with retry button + call-id (`x-litellm-call-id`) for support |
| Mid-stream SSE `{"error":…}` | `turn_failed` | Fail THIS turn, keep partial output marked truncated, keep agent loop alive, never auto-replay |

---

## 3. UX

**Login screen** (`features/gateway/LoginScreen`): 3 steps with progress — ① "Open portal" (button opens system browser to Keys page with device name; also show URL + "copy" for non-default browsers — Docker lesson, 01-a); ② paste key into password field (validate-on-paste: format `zn-…`, then live `GET /v1/models`); ③ success → engine/model defaults. Failure states: unreachable portal (`offline`), 401 (wrong/revoked key — distinct message), 200-but-empty-models (entitled to nothing — contact support/plan page). i18n keys `gateway.login.*`.

**Account/plan/usage meter:** header account menu gains plan name + spend meter (spend vs cap bar, "as of HH:MM" staleness chip); settings gets a Gateway section with the same + reset explainer + "Manage billing" (opens portal). Source: quota snapshot; stale > one budget window renders as "unknown", never zero.

**Soft/hard warnings:** soft = spend ≥80% of cap → non-blocking banner with % + manage link (traffic continues); hard = budget 429 → full blocking state (what hit, figures, reset hint, who-can-raise = upgrade link). Never a bare "429".

**Blocked state with upgrade link:** `gateway.blocked.*` strings; primary button opens portal billing in system browser; secondary "retry" re-checks (cheap `GET /v1/models`).

**Model picker:** shows EXACTLY the cached entitled alias list; unknown/stale models never offered; empty list = blocked state (not an empty dropdown). Per-engine default memory preserved (existing `default_models` settings).

**Engine picker:** v1 shows only supported engines with providers configured (claude, codex, kimi, grok, pi, omp, opencode, dsh, mcode — minus any failing its milestone gate). Unsupported-installed engines (qoder, agy) are hidden with a one-line roadmap note in settings, not dead rows. Each engine row states restart-vs-hot-reload behavior after channel changes (CC-Switch lesson: only Claude hot-reloads).

---

## 4. Branding + removal list

**Brand (DEFAULT, Q1 overrides):** name `Zaino Desktop`; bundle id `ai.zaino.desktop`; scheme `ai.zaino.desktop:/callback` (reserved for M7 OAuth; registered but unused in M1 to avoid dead surface — or register at M7; decision: register at M7 with the OAuth milestone); updater endpoint `https://<update-host>/latest.json` + fresh minisign keypair (M6).

**Files to touch (exhaustive):** `package.json` (name/version), `src-tauri/tauri.conf.json` (`productName`, `identifier`, `plugins.updater.{endpoints,pubkey}`, CSP rewrite), `src-tauri/icons/*` + `public/*` + `Logo` component (`components/.../logo`), `src/version/changelog.ts` (re-seed per AGENTS.md rule — the app's update-notes source), window titles, `README*`, `deploy/` worker (delete or repoint — relay dies in v1), `.github/workflows/release.yml` (fork repo + signing secrets).

**Removal list (v1, DEFAULT Q7 = all disabled):**
| Surface | Action | Files |
|---|---|---|
| Baidu Tongji | Delete module + call sites + CSP entries | `src-tauri/src/baidu_tongji.rs`, `src/lib/analytics.ts`, `tauri.conf.json` CSP `hm.baidu.com` |
| Vendor presets | Delete preset tables (keep generic custom-channel UI) | `src/features/settings/providerPresets.ts` (GLM/Kimi/DeepSeek/OpenRouter/Requesty/API-Route rows) |
| Plugin market + skills hub | Disable UI entries + gate commands (fail with "disabled in this build") | market/hub UI, `plugins/market.rs`, `skills_hub/` net code |
| Cloud relay + deploy worker | Delete module + UI + `deploy/worker` | `src-tauri/src/relay.rs`, `deploy/`, relay settings |
| LAN bridge + device pairing | Disable by default; gate `web_*` commands (decide hard-delete vs flag in M5 — recommendation: hard-delete `web.rs` surface, keep code only if mobile companion is on the roadmap; DEFAULT: delete) | `src-tauri/src/web.rs`, `web/`, bridge UI |
| CLI lifecycle vendor installs | Keep (user-initiated) but audit `install.sh/ps1` URLs; no auto-install | `cli_lifecycle.rs` (review only) |
| Docs links | Repoint engine doc URLs to gateway docs where behavior differs (caching loss, shim) | `providers.ts ENGINE_DOCS_URLS`, in-app help |
| Computer-use MCP schema fetch | Pin locally (vendored JSON, hash-checked) instead of raw.githubusercontent at runtime | `computer_use.rs:178` |

**i18n keys to add (both `src/i18n/en.ts` and `zh.ts` — sync is by convention, no parity test exists, so the milestone includes eyeball review):**

| Key | en | zh |
|---|---|---|
| `gateway.login.title` | Sign in to Zaino | 登录 Zaino |
| `gateway.login.step1` | Open the portal and create a device key | 在门户中创建设备密钥 |
| `gateway.login.step2` | Paste your device key | 粘贴设备密钥 |
| `gateway.login.invalid` | That key didn't work. Check for extra spaces or create a new one. | 密钥无效，请检查空格或重新创建 |
| `gateway.login.noModels` | This key isn't entitled to any model yet. | 此密钥暂无可用模型 |
| `gateway.login.offline` | Can't reach the portal. Check your connection. | 无法连接门户，请检查网络 |
| `gateway.quota.usedOf` | ${used} of ${cap} used | 已用 ${used} / 共 ${cap} |
| `gateway.quota.soft` | You've used {pct}% of your budget. | 已使用 {pct}% 的预算 |
| `gateway.quota.stale` | Updated {ago}; may be out of date | 更新于{ago}，可能已过期 |
| `gateway.blocked.title` | Budget exhausted | 预算已用完 |
| `gateway.blocked.body` | Spent {spend} of {cap}. Requests resume next period. | 已花费 {spend} / 共 {cap}，下个周期恢复 |
| `gateway.blocked.upgrade` | Manage billing | 管理账单 |
| `gateway.reauth.title` | Session expired | 会话已过期 |
| `gateway.reauth.body` | Your device key is invalid or was revoked. Sign in again. | 设备密钥无效或已被撤销，请重新登录 |
| `gateway.modelBlocked.body` | {model} isn't in your plan. | {model} 不在当前套餐中 |
| `gateway.degraded.retry` | Retry | 重试 |
| `gateway.engines.unsupported` | Not supported in this build yet | 此版本暂不支持 |
| `gateway.logout.confirm` | Sign out this device? Other devices stay signed in. | 注销此设备？其他设备不受影响 |
| `gateway.logout.revokedNote` | Also revoke the key in the portal to finish signing out everywhere. | 请同时在门户中撤销密钥以完成注销 |

---

## 5. Security checklist + threat model

**Checklist (each becomes a test in its milestone):** [S1] `zn-` bytes absent from `config.json`, native CLI files, child env dumps, logs/stderr captures, webview-accessible IPC, plugin DTOs (copy `plugin_host.rs:814-859` assertion pattern), LAN responses. [S2] proxy binds `127.0.0.1` only (assert bind addr; `0.0.0.0` = fail). [S3] sends fail closed with proxy down (kill proxy → send must error, never direct-connect). [S4] logout assertion (post-logout filesystem scan + keychain re-read = `NoEntry`). [S5] redirect/paste validation (reject non-`zn-` input, length/shape check before network). [S6] error paths leak nothing (401/403/429 messages contain no key material; `redact_secrets` covers new proxy logs). [S7] updater signature enforced (pubkey pinned, no `dangerousInsecureTransportProtocol` in prod). [S8] CSP tightened (no `hm.baidu.com`, no new `https:` img exceptions beyond artwork domain if any).

**Threat model:**
- *Stolen config files* (backup, shared machine, dotfiles repo): impact REDUCED vs upstream — files hold loopback URLs + dummy keys only. Residual: metadata (which engines, model aliases, usage ledger). Mitigate: keep `0600` where the codebase already sets it; document "treat `~/.ccgui-next/` like `~/.ssh/`".
- *Malicious plugin*: cannot read credentials by design (§5 of audit: no credential IPC in bridge, DTO assertions). Residual: granted `network:` to attacker host exfiltrates *session content*; `exec:` = local code execution; `agent` = spend on user's budget. Mitigate: never grant `network:` to the gateway host (plugin must not ride the user's key); permission-diff review on update; quarantine path intact. Document that installing a plugin = trusting it with chat content.
- *LAN bridge*: REMOVED in v1 (threat eliminated). If a future milestone restores it: token + device-approval gates exist, but `get_cli_config` IPC would expose the gateway key to bridge clients — so restoration REQUIRES first splitting that IPC or scoping bridge commands. Recorded as a precondition, not a footnote.
- *Deep-link hijack (M7)*: loopback preferred (no OS registration to squat); if scheme registered, attacker app could claim it → mitigations: PKCE (code useless without verifier), `state` + `iss` validation, exact redirect match, short code lifetime, single-use codes. Loopback-only deployment avoids the class entirely on desktop.
- *Log leakage*: stderr capture redacts `sk-*`/bearer/api-key patterns (existing) — extend pattern set to `zn-` on day one (M1). Proxy access log: method/path/status/duration/bytes only.
- *Supply chain*: presets deleted (no third-party relay in defaults); market disabled (no remote code install); updater pinned to own key (upstream releases rejected by signature — verify this explicitly in M6 test: old upstream pubkey must FAIL).
- *Keychain threats*: unlocked-login keychain reads by same-user malware are out of scope (OS boundary); `Ambiguous` duplicates and lockouts handled per 01-b table, never by crashing or by falling back to plaintext.
- *Updater downgrade*: default comparator (`version > current`) kept; rollback procedure documented (server + comparator override), never silent.

---

## M3 cancelled — Zaino-only scope (2026-10-16)

Per explicit direction, the multi-engine onboarding track (codex → kimi → grok → pi/omp → opencode → dsh → mcode) is CANCELLED. The product stays Claude Code CLI + Zaino gateway + entitled aliases only. The M2 `channels.rs` registration builders were removed for the same reason (untested-by-use code has no place in the tree). The upstream multi-engine picker UI remains for now; stripping it to Claude-only is a separate, explicitly-approved job — not snuck in here.

## 6. Milestones

Conventions: each milestone lists files to touch (new files preferred), tests (Vitest + `cargo test` + one manual e2e script in `docs/gateway/e2e/Mn-<name>.sh`), acceptance criteria (observable, no "works correctly" without a probe). Human-gated steps (fork creation, signing ceremony, release) are marked HUMAN. I do not commit/push (your standing rule).

### M1 — Thinnest slice: login → models → one Claude chat (DEFAULT Q3-b, no portal changes)

Scope: fork (HUMAN: create `ai-zaino-desktop` repo, push base @add60809) + kill-switch removals (telemetry module + CSP entries + preset tables — small, prevents leaks during dev) + `gateway/store.rs` (keychain) + `gateway/proxy.rs` minimal (forward chat/messages/responses/models, inject Bearer, stream, strip upstream headers, 127.0.0.1 + ephemeral port + per-launch token) + `gateway/catalog.rs` (ids-only cache) + `features/gateway/` login screen + Claude registration (loopback base URL via existing `channel_env`; model alias `fast`).
- Files: NEW `src-tauri/src/gateway/{mod,store,proxy,catalog,error}.rs`, `src/features/gateway/*`, `docs/gateway/e2e/M1-*.sh`; EDIT `lib.rs` (module + 5 IPC commands), `tauri.conf.json` (CSP minus baidu), `providerPresets.ts` (delete vendor rows), `engine/mod.rs` (route `gateway` channel id → proxy base URL — minimal hunk, listed), i18n (login keys only).
- Tests: `cargo test gateway_store` (keychain mock/mutex behavior, wipe assertion); `cargo test gateway_proxy` (path/method/header fidelity incl. `anthropic-beta`, SSE byte-identity vs direct, strip-list enforcement, 127.0.0.1-only bind, fail-closed when upstream down); vitest login-state machine (offline/401/empty-models copy paths); manual `M1-login-chat.sh` (login → models → one `fast` Claude turn, assert spend accrued server-side).
- Accept: paste-key login works from a clean keychain; `/v1/models` drives the picker; one streamed Claude turn completes; `zn-` grep over repo-home + logs empty; telemetry endpoints provably uncalled (proxy log / build grep for `hm.baidu`).

### M2 — Proxy soak gate + quota/error UX (blocks ALL engine onboarding; R1 fallback armed here)

Scope: `gateway/quota.rs` + `gateway/error.rs` + quota/blocked UI (registration writers were built in M2 as `channels.rs`, then removed with the M3 Zaino-only cancellation — see note above); soak suite: 100-turn streaming fidelity (hash SSE bytes direct-vs-proxy), 10-min idle stream survival, mid-stream abort, forced-budget 429 (shape asserted: no retry-after), rate-429 with `retry-after` honored, upstream 500 failover behavior, concurrent turns; timeout exclusions verified; `M2-soak.sh` runs the matrix and prints PASS/FAIL per case.
- Tests: `cargo test gateway_` full module; vitest quota-state machine (soft/hard/re-auth/degraded copy + no-retry assertions on budget 429); manual matrix script.
- Accept: byte-identical streams; budget-429 never retried (assert call count = 1); quota meter shows authoritative spend/cap with staleness chip; **R1 rule: any engine failing here falls back to env-pointer files for that engine only (documented deviation), never literals.**
- Also: `x-litellm-key-remaining-*` presence re-check with limited keys; streaming error-shape through edge asserted.

### M3 — Engine onboarding (codex → kimi → grok → pi/omp → opencode → dsh → mcode, in that order)

Each engine = one sub-milestone: registration writer + alias model mapping + one manual e2e turn + engine-specific traps asserted (codex: responses-only + `env_key`-vs-`auth.json` precedence documented in UI; OpenCode: shadowing warning + `opencode debug config` check; pi/omp: `!command` NOT used (proxy needs no per-request helper — static loopback URL suffices); dsh/mcode: live alias-ID test). Order rationale: protocol risk descending (responses shim first), file-writers last.
- Tests: per-engine `cargo test gateway_channels_<engine>` (file content assertions: loopback URL present, `zn-` absent); vitest picker filtering; manual `M3-<engine>.sh`.
- Accept: one real turn per engine through the proxy; logout wipe covers that engine's files; engine picker hides unconfigured/failed engines.

### M4 — Logout/revocation completeness + multi-device + offline matrix

Scope: `gateway_logout` orchestration (drain → keychain delete + confirm → revoke-or-deep-link → file removal → assertion scan), second-device flow (same portal account, distinct device key; verify spend attribution separates), offline/expired matrix (no-network, 401, 403-model-removed, revoked-mid-session).
- Tests: `cargo test gateway_logout` (incl. assertion-scan unit test with fixture tree); vitest offline-state machine; manual `M4-logout.sh` (logout → grep filesystem for `zn-` → must be empty; re-login works; other device unaffected — needs 2 keys, documented).
- Accept: post-logout scan clean; revocation server-side confirmed (key 401s after); multi-device spend separates in portal.

### M5 — Branding + removals + i18n lockdown

Scope: §4 file list (names, icons, changelog re-seed, doc links, updater endpoint placeholder), hard-delete relay/web-bridge/market/skills-hub surfaces (or flag-gate with justification if roadmap needs them — decision logged), updater pointed at own host (unsigned channel until M6, updater remains OFF by default flag), full i18n pass (every new key in en+zh, eyeball review — no parity test exists).
- Tests: build grep suite (no `hm.baidu`, no `ccgui` user-visible strings, no upstream update URL, no vendor preset hosts); vitest snapshot of login/quota copy in both locales; manual `M5-brand.sh` (fresh install eyeball checklist).
- Accept: zero non-gateway outbound calls observed in a scripted session (proxy log of process egress); both locales render all new screens.

### M6 — Updater cutover + signing + release pipeline

Scope (several HUMAN steps): generate minisign keypair (HUMAN ceremony, password in CI secrets), `latest.json` host, Apple Developer ID + notarization + staple, Windows Artifact Signing/OV + timestamp, Linux AppImage (+deb/rpm test per PR #2624), fork CI secrets, `createUpdaterArtifacts:true`. Test that upstream-signed artifacts FAIL against the fork pubkey.
- Tests: `cargo test` updater-config (endpoint/pubkey assertions); manual `M6-update.sh` (install N-1 → publish N → auto-update applies; tampered payload rejected; downgrade refused by default).
- Accept: signed build per OS installs clean (no Gatekeeper/SmartScreen block on fresh machine — VM check), update round-trip works, key-custody doc filed.

### M7 — Proper portal auth (deferred, needs Q3 answer + portal work)

Scope: portal OAuth2/OIDC server (`oidc-provider` mount or Better Auth migration — decision in Q3), Tauri loopback PKCE login replacing paste, refresh rotation in proxy, device-grant fallback, portal-side per-device session list. Only then: portal usage polling, short-lived gateway tokens (Q4), bridge-restore precondition review.
- Accept: login without pasting; refresh invisible across a week-long CLI session; revoke-one-device from portal kills exactly that device.

---

## 7. Risks, open questions, what could not be verified

**Risks:** R1 axum streaming fidelity (gated by M2 soak — only UNVERIFIED load-bearing item in v1 path); R2 Windows loopback firewall prompts + single-instance deep-link (M7) quirks; R3 NVIDIA single-pool hidden ceiling under concurrent desktop users (gateway-side, not desktop-fixable — recommend per-device concurrency default 1–2 turns); R4 CLI-version drift (all six vendors changed wire options within 12 months — pin versions in M3, re-verify quarterly); R5 minisign key loss = forced manual reinstall (ceremony + custody doc in M6).

**Open questions (unchanged carriers):** Q1 name/bundle (DEFAULT used), Q2 OS scope, Q3 portal-OAuth scope (M7 shaped, M1 needs nothing), Q4 token lifetime (M1 works either way; proxy is future-proof), Q5 quota cadence (headers-first needs nothing new), Q6 update host, Q7 surface kills (DEFAULT all-off).

**Could not verify (no code change may assume these):** axum SSE/timeout behavior on our routes (M2 probe); `x-litellm-key-remaining-*` on v1.103.1 (M2 probe); streaming SSE error shape through OUR edge (M2 probe); `GET /key/info` query-param nulls (use portal client shape meanwhile — portal's own flow is proven); dsh/mcode alias-ID live behavior (M3 probe); Gemini-cached-session `BASE_URL` ignore on target version (only matters if grok path reuses that pattern — grok uses `env_key`, low risk); CrabNebula staging UI (only if dynamic server chosen in M6); exact Apple/Windows signing costs at purchase time (verify at M6).
