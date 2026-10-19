# Phase 0 — Repo Audit: ccgui as a front for the Zaino gateway

- Base: `github.com/zhukunpenglinyutong/desktop-cc-gui` @ `add60809` (v1.1.5), cloned 2026-10-16.
- Method: full source read (3 parallel deep passes + direct verification greps). No code changed.
- Label key: **VERIFIED** = read in code or ran it (file:line given). **ASSUMPTION** = inferred, needs a probe. **UNKNOWN** = could not determine; carried to Phase 1/3.
- My backend ("Zaino gateway") facts below are VERIFIED against `/Users/user/Workspace/gateway` @ `d5a949b` unless marked otherwise.

---

## 1. Base identity and claim check

| Claim (brief) | Verdict |
|---|---|
| Multi-engine desktop GUI over CLI coding agents | VERIFIED. 12 engine IDs in `src-tauri/src/config.rs:11-24` and `src/features/settings/providers.ts:5-18`: `claude, kimi, grok, codex, pi, omp, dsh, agy, opencode, qoder, qoder-cn, minimax` |
| Engine list "Claude Code, Codex, OpenCode, Kimi, Grok, Pi, OMP, DeepSeek Harness, Antigravity, Qoder" | PARTLY WRONG. `dsh` = DeepSeek Harness (`src-tauri/src/dsh_host.rs:684` names `@deepseek-ai/dsh`), `agy` = Antigravity. But there are **12** engines, not 10: `qoder-cn` and `minimax` (`mcode` binary) are extra and were not in the list |
| One protocol adapter per CLI in `src-tauri/src/engine/` | VERIFIED. One module (or more) per engine, see §4 |
| Tauri 2, React 18, TS strict, Tailwind 4, zustand, Vite 6, pnpm workspace | VERIFIED. `package.json`: `react ^18.3.1`, `zustand ^5`, `tailwindcss ^4`, `vite ^6`, `typescript ^5.6.2`, `packageManager pnpm@10.29.3`, `@tauri-apps/api ^2`, `@tauri-apps/plugin-updater ^2.11.3` |
| Rust deps git2, rusqlite, portable-pty, axum | VERIFIED. `src-tauri/Cargo.toml`: `rusqlite 0.32 (bundled)`, `git2 0.20`, `portable-pty 0.8`, `axum 0.8 + ws` |
| Feature modules in `src/features/` | VERIFIED. `bots, browser, chat, commands, files, git, launch-script, mcp, mission, open-app, pet, prompts, settings, plugins, shortcuts, skills, terminal, update, worktree` |
| "No parallel credential store" (channels only in native CLI configs) | **WRONG — important.** Channels incl. plaintext API keys are stored in the app's own `~/.ccgui-next/config.json` (`src-tauri/src/config.rs:101-105`, pretty-printed JSON, default umask, no `0600`). Native CLI files are edited only via the separate 官方配置 (official-config) editor or legacy migration, never by channel switching (`src-tauri/src/config.rs:386-390`, regression test `config.rs:596-656`). So there IS a parallel store, and it holds secrets in plaintext. Directly relevant to hard requirement 2 |
| Presets for GLM/Kimi/DeepSeek/OpenRouter, CC Switch import | VERIFIED. `src/features/settings/providerPresets.ts:172-353` (15 claude rows, 12 codex rows, kimi×2, grok×1); CC Switch import is read-only from `~/.cc-switch/` (`src-tauri/src/cc_switch.rs:1-13`), claude/codex/grok only |
| Plugin SDK + declarative settings sections + trust boundary | VERIFIED, with a caveat: there is **no sandbox**. Plugin JS runs in the main webview; the boundary is install-time review + permission re-checks per call + quarantine/uninstall (`src-tauri/src/plugin_caps.rs:6-13`, `src/features/plugins/runtime/hardening.ts:1-17`). Plugins **cannot** read provider credentials via the API (allowlist design, tested at `plugin_host.rs:814-859`). See §5 |
| Updater via GitHub Releases | VERIFIED. Endpoint `https://github.com/zhukunpenglinyutong/desktop-cc-gui/releases/latest/download/latest.json`, minisign pubkey in `src-tauri/tauri.conf.json:66-73`; release workflow `.github/workflows/release.yml` (macOS signed+notarized, Linux AppImage+RPM, Windows NSIS) |
| Bilingual UI, `src/i18n/zh.ts` + `en.ts` stay in sync | FILES EXIST (2302 vs 2357 lines). Sync **enforcement mechanism UNKNOWN** — no dedicated key-parity test found; feature tests merely touch i18n. ASSUMPTION: sync is by convention/review |
| `pnpm build`, `pnpm test`, `cargo test` must pass; no hardcoded UI text; no `any`; no secrets in commits; Conventional Commits | MIXED. `pnpm build` (`tsc --noEmit && vite build`), `vitest run`, cargo tests all exist. No eslint/commitlint/husky configs found in repo root — so "no `any`" and "Conventional Commits" are UNVERIFIED as enforced rules (git log does use conventional-style messages; AGENTS.md governs agent behavior, not a lint gate). The `plugin-skill:docs` coupling IS enforced by test (`creator-skill-docs.test.ts:19-79`) |
| "Engines can reach my gateway in the protocol each expects — do not assume" | Correct to flag. Per-engine verdicts in §4. Short version: 7 plausible (claude, codex, kimi, grok, pi, omp, opencode), 5 vendor-locked (qoder, qoder-cn, agy, dsh, minimax) |

---

## 2. My backend (VERIFIED against the gateway repo)

- **Gateway base URL (prod):** `https://api.zaino.soon.it` (Caddy → auth-edge `:4001` → LiteLLM v1.103.1 `:4000` → `https://integrate.api.nvidia.com/v1`). VERIFIED (`gateway/config/litellm.yaml`, `CONTEXT.md`, live-curl tested 2026-10-15: all three aliases answer).
- **Upstream today:** single model `nvidia/nemotron-3.5-super-vl-120b-a12b` behind three aliases `fast/smart/frontier` (identical nominal rates). The alias set can grow without client changes if clients treat it as data.
- **Wire compatibility offered:**
  - `POST /v1/chat/completions` — native, end to end. VERIFIED.
  - `POST /v1/messages` — accepted; LiteLLM **translates** to chat/completions **lossily (drops `cache_control`)**. VERIFIED (`gateway/DESIGN.md §4`, `config/litellm.yaml` comment). Prompt caching silently does not work through this path today.
  - `POST /v1/responses` — accepted; `edge/server.mjs:77,320-338` translates Responses→Chat in front of LiteLLM. VERIFIED present in code (shim rules: reasoning never becomes visible text, stream always terminates, idempotent finish, error status preserved).
  - Auth on all three: `Authorization: Bearer zn-…`, rewritten to `sk-…` at the edge. Customer keys are LiteLLM virtual keys with budgets.
- **Portal auth:** Auth.js v5, **Credentials provider only** (email + password, scrypt). **No OIDC/OAuth2 provider, no Device Authorization Grant.** Sessions are JWTs (`portal/auth.ts:6-99`). Login UI: `portal/app/sign-in/page.tsx`. There is no `/authorize` endpoint, no client registry, no PKCE support today. **This is the single biggest backend gap for the desktop login (see §8, Q4).**
- **Credential model:** per-user long-lived API keys (`zn-` 43-char base64url body, SHA-256 stored, `portal/lib/keys/policy.ts`). No short-lived JWTs for gateway access; no refresh-token concept. Master key is internal-only (portal→LiteLLM).
- **Models endpoint:** `GET /v1/models` on the gateway (LiteLLM, auth required) returns the deployed aliases. Live-verified: `['fast','smart','frontier']`.
- **Per-plan entitlements:** yes. `plans.models` arrays (Starter `fast,smart`; Pro all three); enforced as key∩team model intersection in LiteLLM (`updateTeamModels`, the §5.26 fix). Portal has `/api/subscription`, `/api/usage`, `/api/usage/summary` for polling.
- **Limits model:** LiteLLM virtual-key budgets (`max_budget`, `budget_duration`), per-key RPM/TPM/concurrency. `budget_exceeded_status_code: 429` (`config/litellm.yaml:178`). **Rate-limit/quota response headers: UNKNOWN** — no `x-ratelimit-*` emission found in gateway config or portal client. Clients today learn quota by polling portal endpoints, not from gateway headers. 401 = bad key, 403 = model not allowed for key, 429 = budget/rate exhausted.
- **Spend metering:** portal `collect-usage` job maps LiteLLM spend logs to alias + route into `usage_records`; costs are upstream-nominal × plan multiplier. A desktop app does NOT need to compute cost — but it must not trust local state (hard req. 1): poll `/api/subscription` + `/api/usage/summary`.

---

## 3. Provider channels: creation, validation, storage

Store of record: `src-tauri/src/config.rs`. `upsert_provider(engine,id,json)` (`config.rs:283-303`) persists **arbitrary JSON verbatim — no validation** — to `~/.ccgui-next/config.json` (`config.rs:101-105`, pretty JSON, **plaintext, default umask, no `0600`**). `set_current_provider` (`config.rs:361-392`) only stores the selected id and never touches native files (regression-tested). Channel shape consumed at send time: flat `baseUrl/apiKey/model` + raw `env` map + CC-Switch `settingsConfig.{env,auth,config}`; raw env wins, flat fields fill gaps, codex lifts `settingsConfig.auth.OPENAI_API_KEY` (`provider_files.rs:530-603`). Send-time validation only refuses blocked loader/hook/proxy/git/editor keys and skips empty/non-scalar values; refusals log the key **name** only, never the value (`provider_files.rs:423-463,543-548`).

Per-engine env mapping (`provider_files.rs:468-493`): claude `→ANTHROPIC_BASE_URL/_AUTH_TOKEN/_MODEL`; codex synthesizes `model_providers.ccgui{name,base_url,wire_api=responses}` plus `CCGUI_CODEX_*` env indirection (`engine/codex.rs:114-262`); kimi `→KIMI_MODEL_*`; grok `→GROK_*` translated to native `GROK_MODELS_BASE_URL/GROK_XAI_API_BASE_URL/XAI_API_KEY` (`provider_files.rs:583-601`); pi/omp/dsh/opencode/qoder/minimax declare **no channel mapping** (`provider_files.rs:92`) — their CLIs own auth (see §4).

Other secret-bearing writes (all plaintext): `~/.ccgui-next/settings.json` (`webAuthKey/webRelayKey/webAccessToken`, `proxy.rs` system proxy); `~/.ccgui-next/dsh-host-credentials.json` (host cookie+launch token, no chmod); `~/.ccgui-next/provider-backups/` (may contain pre-migration secrets); pi `auth.json` / omp `agent.db` / `models.json|yml` (0600 via `atomic_write_private`, but content is plaintext key material); per-send claude staging overlay `claude-staging/channel-<uuid>.json` (0600, deleted after send).

**No OS-keychain integration anywhere.** No `keyring`/`stronghold`/`secret-service`/`oo7` crate in `Cargo.toml`/`Cargo.lock`; no Keychain/Secret-Service/DPAPI API calls. The only keychain-adjacent strings are git-helper docs and an env-name guard. Every secret lives in a file.

Frontend exposure: `get_cli_config` returns full secrets incl. `apiKey` to the webview by design (`providers.ts:203-220`, rows unmasked); only pi/omp key lists are masked (`mask_key`, head6+tail4). IPC handlers carrying secrets: `upsert_provider`, `fetch_provider_models{base_url,api_key}`, `official_config_write`, `pi_family_auth_set_api_key`, `pi_family_models_config_write`, `send_message{providerId}`, `update_app_settings` (`lib.rs:362-375,453-457`). No secret logging found (stderr capture redacts `sk-*`/bearer/api-key/token patterns, `engine/reader.rs:115-133`).

---

## 4. Engine adapters and gateway compatibility

Common send pipeline (`engine/mod.rs:516-687 prepare_launch`, `:971-1236 send_reserved`): resolve engine → plan/permission/tool gates → provider resolve → `channel_env` injected as child env → per-engine isolation (`claude_channel::apply`, `kimi::apply_channel`, `codex::apply_channel`, `grok::isolate_channel`) → spawn or host-stream. Secrets travel as **process env or staged files, never baked into persistent native configs on the send path** — a good substrate for the gateway work (only `~/.ccgui-next/config.json` persists them).

Usage/cost: per-turn token ledger only (`usage.rs` → local `usage_ledger` sqlite; zero-token turns skipped). **No money anywhere.** Frontend normalizes provider-specific usage shapes (`features/chat/usage.ts:61-97`).

| Engine | Launch / creds | Model list | Gateway verdict |
|---|---|---|---|
| `claude` (Claude Code CLI) | `claude -p --input-format/--output-format stream-json …` (`engine/claude.rs:71-216`); channel via 0600 staging `--settings` overlay (`claude_channel.rs:68-153`), `ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL` | static CLI aliases `default/opus/sonnet/haiku/fable` + native-config registry (`models/claude.rs`) | **COMPATIBLE.** Speaks `/v1/messages` against `ANTHROPIC_BASE_URL` = my gateway; translated lossily (no prompt caching — §2). Alias remap `claude_channel::resolve_model` (`claude_channel.rs:28-66`) must map `fast/smart/frontier`, not `opus/…` |
| `codex` (OpenAI Codex CLI) | local `app-server` JSON-RPC (`codex.rs:289-322`, driver `codex_app.rs`) or WSL `exec --json`; channel via `-c model_providers.ccgui{…,wire_api=responses}` (`codex.rs:114-262`), files never written | `codex debug models` binary catalog (`models/codex.rs`) | **COMPATIBLE (verify CLI version in Phase 1).** `wire_api=responses` → my `/v1/responses` shim; `wire_api=chat` → native chat/completions. Preflight requires `--json` in `exec --help` (`codex.rs:595-644`) |
| `kimi` (Kimi CLI) | local `kimi acp` (driver shared with grok ACP) or headless `kimi --output-format stream-json`; channel env-only `KIMI_MODEL_{NAME,API_KEY,PROVIDER_TYPE,BASE_URL}` (`kimi.rs:36-78`), `provider_type ∈ {openai,anthropic,kimi}` | `kimi provider list --json` or `~/.kimi-code/config.toml` (`models/kimi.rs`) | **COMPATIBLE via `provider_type=openai`.** VERIFY against current Kimi CLI docs (env names, base-URL support) in Phase 1 |
| `grok` (Grok CLI) | local `grok agent … stdio` ACP or headless streaming-json; isolated `GROK_HOME` staging dir with merged `config.toml` (`grok.rs:11-127`), sessions symlinked back | local `[model."alias"]` TOML only (`models/grok.rs`) | **LIKELY COMPATIBLE** (OpenAI-style base URL + key). VERIFY against current Grok CLI docs in Phase 1 |
| `pi` / `omp` (oh-my-pi) | `pi/omp --mode rpc[/-ui]` children + `omp --mode acp` plan transport; **auth owned by native stores** (`~/.pi/agent/auth.json`, `~/.omp/agent/agent.db`, `models.json/yml` for custom providers — `pi_family_auth.rs`) | `<bin> models --json` probe + configured-file merge (`models/pi.rs`, `models/mod.rs:386-408`) | **LIKELY COMPATIBLE as custom providers** (`models.json/yml` accept `baseUrl`+key). VERIFY oh-my-pi provider schema in Phase 1. Note: writing these files = credential material in native config (hard-req-2 mitigation needed) |
| `opencode` | managed `opencode serve` on loopback (`opencode_server.rs:98-172`), SSE session driver (`opencode_session.rs`); **no channel adapter — server owns auth/config** | `opencode models` CLI probe, 17-row offline fallback (`models/opencode.rs`) | **LIKELY COMPATIBLE** via opencode's own provider config (`opencode.json`), NOT via ccgui channel injection. VERIFY how the managed server resolves provider config (workspace file? env passthrough?) in Phase 1 |
| `qoder`, `qoder-cn` | `qodercli --acp` spawned per turn (`qoder_session.rs:915-919`); driven by ACP `session/new` model probe | ACP handshake probe only (`models/qoder.rs`) | **NOT COMPATIBLE.** CLI-owned login, no base-URL/key channel. Exclude from v1 |
| `agy` (Antigravity) | `agy --output-format stream-json --print …` (`agy.rs:57-137`) | `agy models` TSV (`models/agy.rs`) | **NOT COMPATIBLE.** CLI-owned login. Exclude from v1 |
| `dsh` (DeepSeek Harness) | host-owned: `dsh web` on `127.0.0.1:3080`, mux WS driver (`dsh_session.rs`, `dsh_host.rs`) | host RPC `session/modelCatalog` (`models/mod.rs:232-323`) | **NOT COMPATIBLE.** Host-owned auth. Exclude from v1 |
| `minimax` (`mcode`) | `mcode acp` / `mcode exec --output-format stream-json` (`minimax.rs`) | live ACP `session/new` probe (`models/minimax.rs`) | **NOT COMPATIBLE** (no channel env/file adapter; native CLI config only). Exclude from v1 |

**Recommended minimal set for v1: `claude` + `codex`.** Rationale: both are env/process-scoped (nothing persistent written on the send path), both wire protocols are served by my gateway today (translated messages; shimmed responses), and both have the most code paths already exercised (staging isolation, read-only planning, usage tails). Fast follows, in order: `kimi` → `grok` → `pi/omp` (native-file writes need the req-2 mitigation first) → `opencode` (config-resolution question). Excluded: `qoder`, `qoder-cn`, `agy`, `dsh`, `minimax`.

---

## 5. Settings, plugins, trust boundary

Settings: `AppSettings` (`settings.rs:25-224`, persisted by `persist_settings_to`, `atomic_write` without chmod) holds tiers, proxy, bin overrides, `web_auth_key`, relay url/key, access token. Provider UI (`CliConfigSection → CliEngineCard → ProviderDialog`) writes through `upsertProvider` IPC; rows display secrets unmasked.

Plugin SDK (`packages/plugin-sdk`, v0.3.20): manifest (`manifest.ts:35-75`), 38 permissions (`spec/permissions.json`), bridge allowlist of 7 commands (`context.ts:762-789`: http/exec/agent/workspace), 15 extension points incl. settings sections (`context.ts:428-444`). Host re-checks permissions per call (`plugin_host.rs:15-34`, `plugin_caps.rs:285-289`).

Trust boundary: **explicitly not a sandbox** — plugin JS runs in the main webview; forged-`plugin_id` IPC is acknowledged possible; enforcement = marketplace review + quarantine/uninstall + tracked-process kill (`plugin_caps.rs:6-13`, `hardening.ts:1-17`). **But credential reads are structurally absent, not merely gated:** `get_cli_config`/`upsert_provider`/`official_config_write`/`fetch_provider_models` are NOT in the plugin bridge; model-catalog DTOs are asserted free of `apikey/api_key/token/auth/credentials/env/baseurl/endpoint` keys and `sk-`/`http` values (`plugin_host.rs:814-859`); probe errors are replaced with `"provider model refresh failed"` before crossing (`plugin_host.rs:488-519`). Residual exfiltration vectors (granted `network:`/`exec:`/`agent` — arbitrary bodies/processes/engine runs) are data-egress vectors for *session content*, not credential reads. For this project: plugins must additionally never be granted `network:` to the gateway host with user headers, and Phase 3 will forbid gateway-credential-adjacent grants.

---

## 6. Network surface

**LAN bridge (`web.rs` + `web/`):** binds `0.0.0.0:<port>` (`web.rs:278-290`); token = persisted `web_access_token` or 64-hex generated (`web.rs:259-267`); token-in-URL design (`web.rs:6-8`); device pairing via one-time 8-char key + desktop approval, revocation checked every 5s (`web.rs:399-401,594-636,816-838`); relay mode (loopback + `x-ccgui-via`) waives token but requires device approval (`web.rs:440-463`). Authenticated bridge ≈ full local user: ~90 commands incl. provider CRUD, `official_config_write`, `fetch_provider_models{base_url,api_key}`, `send_message`, full files/git/terminal/history (`web/dispatch.rs:590-1324`). Absent by design: filesystem-grant widening, plugin install/enable, exec/agent bridge, MCP probe, window control (`dispatch.rs:1135-1136,1278-1281`). `/file?path=` serves any `$HOME` file except denylisted credential dirs (`$HOME/.ssh/.aws/.gnupg/.ccgui-next`, whole `app_home/`) (`web.rs:961-992`). **For this project the bridge is in scope to disable/lock down (hard req. 5): it can read `~/.ccgui-next/config.json` only via `official_config_read`-style commands — actually `app_home()` is denied for `/file`, but `get_cli_config`/`official_config_read` IPCs ARE bridged, so a LAN/relay attacker with the token reads provider secrets. Device approval + token are the only gates.**

**Relay (`relay.rs`):** outbound `wss://<cloudflare-worker>/agent?key=<secret>` (desktop dials out; Worker holds no policy beyond key); deploy path calls `api.cloudflare.com` and embeds worker source (`relay.rs:372,552-806`). Disable for v1 (hard req. 5 + no non-gateway hosts).

**Updater/release:** endpoint + minisign pubkey in `tauri.conf.json:66-73`; `release.yml` builds macOS (Developer ID `kunpeng zhu (RLHBM56QRH)`, notarized), Linux AppImage+RPM, Windows NSIS; `latest.json` per platform. Fork needs its own endpoint + signing keys (Phase 3).

**Outbound calls inventory (disable/remove candidates for hard req. 5):**
1. Baidu Tongji — `https://hm.baidu.com/hm.js?<site>` + beacon `hm.baidu.com/hm.gif`, site `daa60bcc45c658ee35054b93be3cf2e4` (`baidu_tongji.rs:20-30`, `lib/analytics.ts:48-164`). Linux-native path + Win/macOS external script; prod+main-window only. **Only third-party telemetry. Remove.**
2. GitHub raw/market: `raw.githubusercontent.com/zhukunpenglinyutong/ccgui-plugins/...` plugin index + `github.com/.../releases/download/...` (SHA-256 verified) (`plugins/market.rs:27-51,217-252`). **Point at fork's market or disable.**
3. Skills hub: `api.github.com`, `raw.githubusercontent.com`, `skills.sh/api/search` (`skills_hub/http.rs:24-109`). **Disable or proxy policy decision.**
4. `raw.githubusercontent.com/can1357/oh-my-pi/.../mcp-schema.json` (`computer_use.rs:178`). **Vendor-pinned schema fetch — remove/pin locally.**
5. `api.cloudflare.com` (relay deploy only — dies with relay).
6. CLI lifecycle: `npm view`, `npm i -g`, `claude.ai/install.{ps1,sh}`, `chatgpt.com/codex/install.{ps1,sh}` — manual user action only, never timer-driven (`cli_lifecycle.rs`). **Keep but review; installs run vendor code.**
7. Preset/vendor endpoints are user-configured (GLM/Kimi/DeepSeek/OpenRouter/Requesty/API Route) — **all presets deleted in fork** (hard req. 5 + no non-gateway hosts).
8. `metrics.rs`/`usage.rs`: local-only (sysinfo sampler, sqlite ledger). **Keep, verify no egress (none found).**
9. CSP (`tauri.conf.json:15-16`) allowlists `hm.baidu.com`, `https:` img, preview frames — **rewrite with telemetry**.

---

## 7. Conventions that bind the implementation

- AGENTS.md: read call chains, no empty impls, no swallowed errors, no secret logging, i18n for all user text, IPC/event/contract changes update producers+consumers, verify per affected chain (`pnpm build`, focused vitest, `cargo test <filter>`). **"Never commit/push without explicit human decision" (`AGENTS.md` delivery section) — I will not commit, push, or publish anything in any phase without your explicit go-ahead.**
- i18n: every user string in `zh.ts` + `en.ts` (sync by convention — no parity test found, so Phase 4 must add eyeball discipline or a test).
- Strict TS (`tsc --noEmit` in build), vitest + `node --strip-types` stream tests, cargo tests incl. `send_path`; browser tests in `tests/browser/`.
- New code in new modules; upstream-file edits listed explicitly (hard req. 4 — the plan will carry the list).

---

## 8. Blocker questions (batched — Phase 1 starts after these)

1. **[APP_NAME], bundle identifier, and company/publisher name.** Needed for branding, bundle IDs, and the updater endpoint. (Also: keep the MIT license notice — yes?)
2. **Target OS for v1.** macOS-only (matches your VPS + Apple dev setup) or macOS+Windows+Linux? Determines keychain API, deep-link registration, and signing/notarization scope.
3. **Portal auth for desktop — the big one.** The portal has NO OAuth/OIDC server today (Credentials + JWT sessions only). Ranked options: (a) I add a minimal OAuth2 Authorization-Code+PKCE endpoint set to the portal (new backend work, ~1 milestone); (b) portal-issued per-device API keys via a logged-in browser step ("connect this device" page showing a one-time code); (c) embed login in-app via system browser + session-cookie capture (fragile, not recommended). Which scope is acceptable? My default recommendation absent your input: (b) for M1 (no portal changes), (a) as the M2+ proper fix.
4. **Credential lifetime model.** Backend issues only long-lived keys today. Is minting one revocable key per device (scoped, shown once, wiped on logout) acceptable for v1, or must Phase 1 include a short-lived-token design (new backend work: JWT issuance + LiteLLM passthrough)?
5. **Gateway quotas for desktop concurrency.** Upstream is a single free-tier NVIDIA pool (hidden ceiling; ~1.16%/request failure noted in gateway docs). Do you want per-device concurrency caps in v1, and is polling `/api/usage/summary` every N seconds acceptable, or do you need gateway response headers (new backend work — none exist today)?
6. **Update channel.** Self-hosted `latest.json` + new minisign key (I generate), or disable the updater in v1? (Disabling is one flag + requirement-5 compliant; self-hosting needs a static host + signing ceremony.)
7. **LAN bridge + relay + telemetry + market + skills-hub + presets.** Confirm: disable ALL in v1 (my recommendation), or must any survive (e.g. LAN bridge for a mobile companion)?
