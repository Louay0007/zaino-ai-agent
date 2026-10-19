#!/usr/bin/env bash
# M2 soak gate — manual end-to-end matrix. Automated parts run in
# `cargo test gateway` (byte-identity, concurrency, abort, no-retry,
# passthrough). THIS script covers what unit tests cannot: time, volume,
# the real gateway, and the real Claude CLI path.
#
# Prerequisites: built app, Claude CLI installed, signed in via the app,
# $ZAINO_KEY (per-key budget, e.g. $5 — the matrix spends real nominal
# budget; watch it).
#   export ZAINO_KEY='zn-…'
#
# Matrix (each PASS/FAIL gates M3 engine onboarding):
#   S1 30 in-app Claude turns: every answer complete, usage accrues
#   S2 10-minute idle stream survival (upstream keep-alive, no proxy timeout)
#   S3 mid-stream abort (stop a long turn): usage stops growing, partial kept
#   S4 forced budget-exhaustion (tiny $0.01 key in a second profile):
#      exactly ONE upstream call per send, UI shows hard block, no retry
#   S5 upstream 500 drill: 500s surface as retryable error with call id
#   S6 multi-hour session: proxy memory stable, token set bounded
#
# Byte-identity (proxy output == upstream output) is asserted in-process
# (cargo test gateway::proxy::soak_tests) — this script asserts behavior.
# Any FAIL stops M3. Record results in docs/gateway/02-adr.md R1 line.
set -euo pipefail

: "${ZAINO_KEY:?export ZAINO_KEY='zn-…' first (throwaway key, small budget)}"
BASE="${GATEWAY_BASE_URL:-https://api.zaino.soon.it}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== M2 sanity: direct gateway answers =="
OUT=$(curl -s -m 120 -X POST "${BASE}/v1/chat/completions" \
  -H "Authorization: Bearer ${ZAINO_KEY}" -H 'Content-Type: application/json' \
  -d '{"model":"fast","messages":[{"role":"user","content":"Reply with exactly: SOAK_OK"}],"max_tokens":64,"stream":false}')
echo "${OUT}" | grep -q "SOAK_OK" && ok "direct turn answers" || fail "direct turn broken (stop: gateway, not proxy)"
echo "${OUT}" | grep -qi "nemotron\|nvidia" && fail "upstream model id leaked" || ok "no upstream id in body"

echo "== M2 in-app matrix (human drives the app, script checks the money) =="
echo "Spend before: record from Settings → Zaino gateway, then:"
echo "[ ] S1 30 streamed Claude turns, all complete, spend grows monotonically"
echo "[ ] S2 start a long turn, idle 10 min mid-stream, completes without reconnect"
echo "[ ] S3 abort a turn at ~50%: partial kept, no runaway spend after abort"
echo "[ ] S4 $0.01 key: first over-budget send 429s ONCE (check proxy log: one upstream call), hard-block banner shows figures"
echo "[ ] S5 (optional drill) upstream 500: error surfaces with retry affordance, no silent drop"
echo "[ ] S6 1h session: proxy RSS stable (Activity Monitor/smem), token set bounded (no growth alarms)"
echo ""
echo "RESULT so far: ${PASS} passed, ${FAIL} failed (human items above must all be [x])"
[ "${FAIL}" -eq 0 ]
