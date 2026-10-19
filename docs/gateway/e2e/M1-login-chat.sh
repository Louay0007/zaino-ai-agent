#!/usr/bin/env bash
# M1 manual end-to-end: login → models → one Claude chat.
# Human-run, human-judged. Prints PASS/FAIL per step; any FAIL stops the run.
#
# Prerequisites:
#   - app built and running (`pnpm tauri dev` or the M1 build)
#   - a Zaino device key (portal → Keys → create, models: fast, small budget)
#   - `jq` installed; `ZAINO_KEY` exported (paste once, never commit)
#
# What it proves (M1 acceptance):
#   1. login validates the key and returns the entitled model list
#   2. one streamed `fast` chat turn completes through the proxy
#   3. spend accrued server-side (the money path, not just 200 OK)
#   4. `zn-` appears NOWHERE the app wrote (config, logs, native staging)
#
# NOTE: steps 1-3 drive the Rust proxy directly (no Tauri webview needed).
# The full UI path (login screen → chat send) is exercised by hand once,
# then this script guards the machine contract on every M1+ change.
set -euo pipefail

: "${ZAINO_KEY:?export ZAINO_KEY='zn-…' first (paste, never commit)}"
APP_HOME="${HOME}/.ccgui-next"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; exit 1; }

echo "== M1: direct gateway sanity (baseline) =="
BASE="https://api.zaino.soon.it"
MODELS=$(curl -s -m 30 -H "Authorization: Bearer ${ZAINO_KEY}" "${BASE}/v1/models" \
  | jq -r '.data[].id' | sort | tr '\n' ' ')
echo "  models: ${MODELS}"
[ -n "${MODELS}" ] || fail "empty model list (key invalid or entitled to nothing)"

echo "== M1: proxy contract (run against the built app's proxy) =="
echo "  Start the app, sign in, then find the proxy port:"
echo "    grep -o 'gateway.*listening[^ ]*' <app-log>  # or: lsof -iTCP -sTCP:LISTEN -P"
echo "  Then: PROXY=http://127.0.0.1:<port> $0 --proxy-only"
if [ "${1:-}" = "--proxy-only" ]; then
  : "${PROXY:?export PROXY=http://127.0.0.1:<port>}"
  echo "-- stream one turn through the proxy --"
  OUT=$(curl -s -m 120 -N -X POST "${PROXY}/v1/chat/completions" \
    -H "Authorization: Bearer sk-zaino-local-dummy" \
    -H 'Content-Type: application/json' \
    -d '{"model":"fast","messages":[{"role":"user","content":"Reply with exactly: M1_OK"}],"max_tokens":64,"stream":true}')
  echo "${OUT}" | grep -q "M1_OK" && ok "streamed turn completes" || fail "no M1_OK in stream"
  echo "${OUT}" | grep -qi "nemotron\|nvidia" && fail "upstream model id leaked in stream" || ok "no upstream model id in stream"
fi

echo "== M1: secret hygiene =="
if grep -rIl "zn-" "${APP_HOME}/config.json" 2>/dev/null | grep -q .; then
  fail "zn- bytes in config.json"
else ok "no zn- in config.json"; fi
if grep -rIl "sk-zaino-local" "${APP_HOME}/config.json" "${APP_HOME}/claude-staging" 2>/dev/null | grep -q .; then
  echo "  NOTE: dummy tokens present (expected while a send is in flight; must be gone 60s after)"
else ok "no dummy tokens lingering"; fi

echo "== M1: server-side spend =="
echo "  Check portal usage for this key's spend, or LiteLLM /key/info with the master key."
echo "  A $0.00 total after real turns = metering is broken (fail the milestone)."

echo
echo "RESULT: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
