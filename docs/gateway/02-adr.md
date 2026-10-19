# Phase 2 — Architecture Decision: getting credentials to the engines

- Decides between: **(A)** write the gateway key/token into each CLI's native config · **(B)** local loopback auth proxy injecting fresh tokens · **(C)** hybrid.
- Inputs: `00-repo-audit.md` (code facts), `01-research.md` (precedent + pitfalls). Labels: **VERIFIED** (read/probed), **ASSUMPTION**, **UNVERIFIED**.
- Status: **PROPOSED** — becomes final on your approval (and survives open Q1–Q7 with noted contingencies).

---

## 1. What is actually being decided (narrow it correctly)

The naive framing — "files vs proxy" — is wrong, because **provider registration and secret custody are separable**:

1. **Registration** (unavoidable in all options): several engines only discover a provider from their native files — `pi`/`omp` `models.json/yml`, `opencode.json`, Codex `config.toml`, Kimi/Grok TOML. These files must name the provider and its base URL regardless. What they must NEVER hold is the real key (hard req. 2).
2. **Custody** (the actual decision): where the live `zn-…` key lives at rest and at runtime, who can read it, and what happens on rotation/revocation.

So the real comparison is:

- **(A) File custody**: real key material in native CLI configs (literal `apiKey`, `auth.json`, `.env`-style). Rotation = rewrite N files + restart CLIs. The CC-Switch pattern.
- **(B) Proxy custody**: real key lives in OS keychain at rest → proxy process memory at runtime. Children receive `base_url=http://127.0.0.1:<port>` + dummy key. Native files (where required) hold only the loopback URL + dummy/pointer — no secret. Rotation = proxy re-reads keychain / exchanges refresh; children never notice.
- **(C) Hybrid**: proxy transport where it pays, direct secret-free registration everywhere, with ONE explicit exception lane (documented below) — not "sometimes files hold keys".

A fourth variant dies early and is recorded so nobody re-proposes it: **(A′) env-pointer configs** (files hold `env_key`/`apiKeyEnv`/`{env:VAR}` names; app injects the real key into child env at spawn). It fixes files-at-rest but keeps the key in child env (same-user readable), still needs respawn on rotation, and still needs per-engine schema mastery. It is strictly dominated by (C) — same file writes, worse runtime secrecy, no better compatibility. Rejected.

---

## 2. Constraints the options must satisfy (from the audit + gateway facts)

1. **Engines read credentials differently, and some only once.** VERIFIED: Codex caches config at startup (restart required); only Claude hot-reloads (01-d). OpenCode stored OAuth **shadows** explicit provider config (01-d, issue #10950). Any design that rewrites files mid-session inherits these traps.
2. **Rotation without respawn is only possible via helpers or proxy.** VERIFIED 2026 docs: Claude `apiKeyHelper` (5-min cache re-run), Codex `auth.command` (`refresh_interval_ms`), pi/omp `!command` key source. Static env/file values are startup-read (Aider, Gemini caveats in 01-f).
3. **In-flight SSE cannot have headers swapped.** Any upstream 401 mid-stream kills that stream in every design; the question is only how cheap recovery is (new request with fresh credential vs restart-the-CLI). VERIFIED reasoning, 01-f.
4. **Gateway quotas are per-key budgets with 429s and no Refresh-After on budget exhaustion.** VERIFIED live (01-e). Clients must surface, not retry-loop. This is UI logic, identical across options — not a differentiator, except: the proxy is a natural place to translate gateway 429 bodies into stable per-engine behavior (see §5).
5. **ccgui already injects `channel_env` generically at spawn** (`engine/mod.rs:642-644`, VERIFIED 00-§4). Both (B) and (C) reuse this; (A) additionally needs per-engine file writers.
6. **No secrets to the webview, no plaintext at rest without mitigation** (hard reqs. 1–2). The existing `config.json` plaintext channel store must NOT gain the gateway key — the gateway channel must bypass it (new `gateway` module owns custody end-to-end).

---

## 3. Option analysis

### (A) File custody — write the real key into each CLI's native config

How: extend `provider_files.rs` mappings + per-engine writers for 9 schemas; store `zn-…` in `settings.json` env blocks, `config.toml` (`experimental_bearer_token` or `auth.json`), Kimi/Grok TOML literals, `models.json/yml` literals, `opencode.json`/auth.json.
- Security: worst at rest (9 secret-bearing files, default perms except pi/omp 0600) — violates hard req. 2 in letter; mitigations (0600, scoped revocable keys, wipe on logout) reduce but don't remove fan-out risk. Same-user env/config readable regardless.
- Refresh/revocation: worst. Rotation = rewrite up to 9 files + restart the CLIs that cache (all but Claude). No propagation channel portal→desktop→CLIs exists. Logout must track every path written — and the audit shows writers already exist in 4+ places.
- Compatibility: best understood (CC-Switch proves it), but 9 schemas × CLI-version drift × the Codex `requires_openai_auth`-vs-`env_key` footguns (01-d). Every CLI update is a potential break.
- Streaming: best — no middleman, zero added failure modes.
- Complexity: low to build, high forever (combinatorial maintenance).
- Mergeability: worst — touches `provider_files.rs`, per-engine `apply_channel` paths, settings UI; large upstream surface.

### (B) Proxy custody — loopback axum proxy, dummy key to children

How: new `src-tauri/src/gateway/` module (per hard req. 4): keychain → proxy memory (`127.0.0.1`, ephemeral port, per-launch path/token); children get existing `channel_env` injection with `base_url=http://127.0.0.1:<port>` (+ path mapping) and dummy key; native files (where an engine requires them) get loopback URL + dummy only. Proxy forwards method+path+headers+body byte-faithful to the gateway, injects `Authorization: Bearer <real>`, streams SSE back unbuffered.
- Security: best. Real key exists in exactly two places: OS keychain, proxy memory. Files and child env hold nothing of value. Logout = keychain delete + server-side revoke + kill proxy (in-memory key dies with the process).
- Refresh/revocation: best. Proxy re-reads keychain / performs refresh between requests; children (even week-long `app-server`/`serve` processes) never respawn. Upstream 401 mid-stream still kills that stream (physics), but the retry uses a fresh token with no CLI restart. This is also the ONLY design compatible with short-lived tokens if Q4 goes that way.
- Compatibility: best structural fit. One integration shape (OpenAI-compatible base URL + Bearer) serves all 9 engines; no per-engine schema mastery, immune to config-format drift; sidesteps Codex cached-config and OpenCode shadowing traps (the proxy address is stable; only key material rotates, invisibly). Caveat: engines needing non-OpenAI paths (Claude `/v1/messages`, Codex `/v1/responses`) just work — the proxy forwards paths verbatim to the gateway, which already serves them.
- Streaming: the risk. Must prove: no buffering (axum `Sse` stream, compression off, flush), no timeout kills (exclude stream routes from `TimeoutLayer`, keep-alive), verbatim header forwarding (`anthropic-beta`, `x-api-key`), SSE error-shape passthrough, no body-size caps on inference routes. All enumerated in 01-f; all UNVERIFIED until the soak test. Mitigation is a milestone, not a hope (Phase 3 M2).
- Complexity: moderate one-time (new server component with lifecycle: bind, port, token, shutdown, crash recovery, single-instance port conflicts) vs near-zero ongoing.
- Mergeability: best — new `gateway/` + `features/gateway/` modules; engine files untouched; reuses existing `channel_env` injection.

### (C) Hybrid (recommended shape) — proxy transport + secret-free registration, one exception lane

(C) = (B) as the transport and custody core, plus explicit rules for the two things a pure proxy cannot do alone:
1. **Registration files still get written** where engines require them (pi/omp `models.json/yml`, `opencode.json`, Codex `config.toml`, Kimi/Grok TOML) — but containing ONLY loopback URL + dummy key + model aliases. No secret, so no mitigation burden, no fan-out on rotation, wipe-on-logout still applies (hard req. 3) but is hygiene, not security.
2. **Exception lane:** if the proxy is unreachable at send time (crashed, port conflict), sends FAIL CLOSED with a clear "gateway bridge down — restart" state. Never fall back to direct-with-real-key (that would silently reintroduce (A) through the back door). This rule must be a code invariant with a test.

(C) differs from (B)-pure only in acknowledging (1); there is no design in which registration files vanish. "Pure B with zero file writes" is achievable only for Claude/Kimi/Grok (env-injectable), not the fleet.

---

## 4. Scoring

Scale: ++ (strength) + (adequate) − (weakness) −− (disqualifying without mitigation).

| Criterion | (A) files | (B) proxy | (C) hybrid (recommended) |
|---|---|---|---|
| Secret at rest (hard req. 2) | −− 9 plaintext files | ++ keychain + memory only | ++ same as B; registration files secret-free |
| Refresh without respawn | − (helpers only, per-CLI) | ++ central, invisible to children | ++ same as B |
| Revocation/logout completeness (hard req. 3) | − N paths to track/wipe | ++ 2 places (keychain, memory) + revoke call | ++ same as B + config cleanup |
| Engine compatibility (9 engines) | + proven, −9 schemas × drift | ++ one shape fits all | ++ same as B |
| Streaming reliability | ++ no middleman | − UNVERIFIED until soak test | − same as B (mitigated by M2 gate) |
| Build complexity | + low now | − new server component | − same as B |
| Lifetime complexity | −− combinatorial | + near-zero after M2 | + near-zero after M2 |
| Upstream mergeability (hard req. 4) | − touches engine files | ++ new modules only | ++ new modules only |
| Short-lived-token future (Q4) | −− requires respawns | ++ native fit | ++ native fit |
| No-non-gateway-traffic (hard req. 5) | + (no new egress) | + (loopback only) | + (loopback only) |

**Decision: (C).** It dominates on 7 of 10 criteria, ties on 1, and loses only on streaming-reliability-today and build complexity — both addressed by making the streaming soak test a merge gate (M2) rather than an aspiration. (A) is rejected as primary (fails hard req. 2 in letter, worst lifetime cost); (A′) rejected in §1 as strictly dominated.

---

## 5. Consequences and invariants (binding on Phase 3)

1. The gateway key NEVER appears in `~/.ccgui-next/config.json`, any native CLI file, child env, logs, the webview, IPC payloads readable by plugins, or LAN-bridge responses. Violation = bug, with a test per surface (`plugin_host.rs:814-859` is the pattern to copy).
2. Sends fail closed when the proxy is down. No direct-fallback path exists in code.
3. Model names on the wire are gateway aliases (`fast/smart/frontier`) from the entitlement-filtered `/v1/models` — the desktop never invents model IDs.
4. Quota UI reads gateway truth (`x-litellm-key-spend`/`max-budget` headers opportunistically, portal polling for plan/reset state) and never gates requests client-side.
5. Logout = keychain delete + portal-side revoke + removal of every file the app wrote + proxy teardown, verified by a post-logout assertion (no `zn-` bytes anywhere the app wrote).

## 6. Risks and what would change this decision

- **R1 (largest): streaming fidelity through axum is UNVERIFIED.** If the M2 soak test (chunked SSE, tool-call streams, 10-min idle, abort mid-stream, 429 mid-stream) fails in ways that can't be fixed by config, fall back to (A) for the affected engine only — the per-engine channel injection points already exist, so the fallback is contained. This is the only accepted path back to files, and files would then hold env-pointers, never literals.
- **R2: single-instance port conflicts / firewall prompts** (loopback bind on first run). Mitigate: ephemeral port + persisted port file? No — ephemeral + discovery per launch is simpler; firewall prompts on Windows for loopback binds are rare but must be tested on the target OS (Q2).
- **R3: headless/CI.** Proxy needs the key at startup from keyring (daemon may be absent headless) — same limitation as any design; document portal re-login per launch for that case. Does not affect the decision.
- **What flips the decision:** (i) a target engine that cannot speak HTTP base-URL override (none found in v1 set); (ii) a Q-answer forbidding a local proxy process (no such signal); (iii) soak-test failure per R1.

**M2 deviation log (binding):**
- *Fixed loopback port (`127.0.0.1:18789`) instead of ephemeral.* Native provider files (codex TOML, pi/omp models, opencode.json) cannot track an ephemeral port without rewrite-churn every launch. Per-send token rotation is retained, so secrecy is unchanged; bind conflict fails closed. Rationale recorded in `gateway/mod.rs::PROXY_PORT`.
- *Token-set cap raised (64 → 4096, clear-on-full).* Persistent/long-lived engine servers hold their first token for the session; evicting it mid-session would 401 a healthy run. Logout still wipes the set. Q1/Q2/Q5/Q6/Q7 do not flip it — the ADR is robust to all pending answers as analyzed in each row above.

---

## 7. Phase 3 readiness

Phase 3 may proceed on approval of THIS document. Open inputs it needs (unchanged from 00-§8/01): app name/bundle ID (branding + updater), target OS (signing scope), Q3/Q4 (portal-auth shape affects the login milestone, not the custody decision), update host. The plan must include: M1 thinnest slice (portal login → model list → one chat via one engine — recommend Claude, cleanest env path), M2 proxy soak gate (blocks all engine onboarding), per-engine onboarding milestones with the R1 fallback rule, and the §5 invariant tests.
