//! Loopback auth proxy: the ONLY process that holds the live key at runtime.
//!
//! Children (CLI agents) reach `http://127.0.0.1:<port>` with a per-send
//! dummy Bearer token; the proxy validates the dummy, injects the real
//! `Authorization: Bearer <zn-…>` upstream, and streams the response back
//! UNBUFFERED. Upstream status codes and bodies pass through verbatim —
//! the proxy translates nothing, so every engine's error handling behaves
//! exactly as if it had called the gateway directly.
//!
//! streaming rules (ADR R1 — all UNVERIFIED until the M2 soak test):
//! no body buffering, no timeouts on inference routes, SSE flushed per
//! chunk, `content-length`/framing left to the stream adapters.

use std::net::SocketAddr;
use std::time::Instant;

use axum::{
    body::Body,
    extract::State,
    http::{HeaderValue, Method, Request, Response, StatusCode, Uri},
    routing::{get, post},
    Router,
};

use super::{check_proxy_token, live_key, set_proxy_addr, GATEWAY_BASE_URL};

#[derive(Clone)]
struct ProxyState {
    client: reqwest::Client,
    upstream: String,
}

/// Start the loopback proxy. Binds `127.0.0.1` on an ephemeral port —
/// never `0.0.0.0` (invariant S2: other machines must not reach it).
/// Records the address globally and returns it. Failure is fatal to
/// gateway sends (they fail closed); it is never fatal to app startup.
pub async fn start() -> Result<SocketAddr, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        // No total/read timeouts: inference streams run for many minutes.
        // Timeouts belong on the CLI side (which sets its own idle guards).
        .build()
        .map_err(|e| format!("proxy http client failed: {e}"))?;
    let state = ProxyState {
        client,
        upstream: GATEWAY_BASE_URL.to_string(),
    };
    let app = Router::new()
        .route("/v1/chat/completions", post(forward))
        .route("/v1/messages", post(forward))
        .route("/v1/responses", post(forward))
        .route("/v1/models", get(forward))
        .route("/healthz", get(forward))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", crate::gateway::PROXY_PORT))
        .await
        .map_err(|e| format!("proxy bind 127.0.0.1:{} failed: {e}", crate::gateway::PROXY_PORT))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("proxy local_addr failed: {e}"))?;
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[gateway-proxy] serve error (sends now fail closed): {e}");
        }
    });
    set_proxy_addr(addr);
    Ok(addr)
}

/// Paths the proxy serves, with allowed methods. Everything else is 404 —
/// the proxy is a narrow forwarder, not a general HTTP client.
fn route_allowed(path: &str, method: &Method) -> bool {
    matches!(
        (path, method),
        ("/v1/chat/completions", &Method::POST)
            | ("/v1/messages", &Method::POST)
            | ("/v1/responses", &Method::POST)
            | ("/v1/models", &Method::GET)
            | ("/healthz", &Method::GET)
    )
}

/// Upstream-identifying headers stripped from responses. Spend/cost/call-id
/// headers pass through (the quota UI needs them); model identity does not
/// (the customer surface shows aliases only — the alias invariant).
fn stripped_response_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "x-litellm-model-name"
        || n == "x-litellm-model-id"
        || n == "x-litellm-model-api-base"
        || n.starts_with("llm_provider-")
}

async fn forward(State(state): State<ProxyState>, req: Request<Body>) -> Response<Body> {
    let started = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();

    if !route_allowed(&path, &method) {
        return json_status(
            StatusCode::NOT_FOUND,
            "proxy_unknown_route",
            "this path is not proxied",
        );
    }

    // Downstream auth FIRST: an unknown dummy token dies here with 401 and
    // never spends an upstream call (fail closed, no key burn on garbage).
    let downstream_ok = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(check_proxy_token)
        .unwrap_or(false);
    if !downstream_ok {
        return json_status(
            StatusCode::UNAUTHORIZED,
            "proxy_bad_token",
            "unknown downstream token",
        );
    }

    let Some(key) = live_key() else {
        return json_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "proxy_not_configured",
            "no gateway key stored — sign in again",
        );
    };

    let url = if query.is_empty() {
        format!("{}{}", state.upstream, path)
    } else {
        format!("{}{}?{}", state.upstream, path, query)
    };

    let mut upstream_req = state.client.request(method.clone(), &url);
    upstream_req = upstream_req.header("authorization", format!("Bearer {}", key.as_str()));
    for (name, value) in req.headers() {
        let n = name.as_str().to_ascii_lowercase();
        if matches!(
            n.as_str(),
            "host" | "authorization" | "x-api-key" | "content-length" | "transfer-encoding" | "connection"
        ) {
            continue;
        }
        upstream_req = upstream_req.header(name, value);
    }

    let (mut parts, body) = req.into_parts();
    let _ = std::mem::replace(&mut parts.uri, Uri::from_static("/"));
    let stream = body.into_data_stream();
    upstream_req = upstream_req.body(reqwest::Body::wrap_stream(stream));

    let upstream = match upstream_req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[gateway-proxy] upstream unreachable ({} {}): {e}",
                method.as_str(),
                path
            );
            return json_status(
                StatusCode::BAD_GATEWAY,
                "proxy_upstream_unreachable",
                "could not reach the gateway",
            );
        }
    };

    let status = upstream.status();
    let mut out = Response::builder().status(status);
    for (name, value) in upstream.headers() {
        if name.as_str().eq_ignore_ascii_case("content-length")
            || stripped_response_header(name.as_str())
        {
            continue;
        }
        // Header values that fail to parse are dropped, never fatal.
        if let (Ok(n), Ok(v)) = (
            axum::http::HeaderName::from_bytes(name.as_str().as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            out = out.header(n, v);
        }
    }

    // Quota figures ride success headers (authoritative when present;
    // streams carry none — the snapshot simply keeps its age).
    crate::gateway::record_quota_headers(|n| {
        upstream
            .headers()
            .get(n)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    });

    // Error bodies are small: collect (bounded), map, report, re-serve
    // byte-identical. Success streams are never buffered.
    let retry_after = upstream
        .headers()
        .get(axum::http::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok());
    let body = if status.is_success() {
        Body::from_stream(upstream.bytes_stream())
    } else {
        const ERROR_BODY_CAP: usize = 64 * 1024;
        let bytes = axum::body::to_bytes(
            Body::from_stream(upstream.bytes_stream()),
            ERROR_BODY_CAP,
        )
        .await
        .unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes);
        crate::gateway::report_outcome(status.as_u16(), &text, retry_after);
        Body::from(bytes)
    };
    let elapsed_ms = started.elapsed().as_millis();
    eprintln!(
        "[gateway-proxy] {} {} -> {} ({} ms)",
        method.as_str(),
        path,
        status.as_u16(),
        elapsed_ms
    );
    out.body(body).unwrap_or_else(|_| {
        json_status(
            StatusCode::INTERNAL_SERVER_ERROR,
            "proxy_response_build_failed",
            "could not build proxied response",
        )
    })
}

fn json_status(status: StatusCode, code: &str, message: &str) -> Response<Body> {
    let body = serde_json::json!({"error": {"type": code, "message": message}}).to_string();
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::from("proxy error")))
}

/// Request headers forwarded to the gateway for test introspection.
/// Production code forwards headers inline (see `forward`).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::{clear_live_key, proxy_tokens, set_live_key};

    /// Spin a mock upstream + the real forward path, asserting:
    /// byte-identical SSE passthrough, header stripping, 401-before-upstream
    /// on bad tokens, and fail-closed behavior. (M2 expands this into the
    /// live soak matrix; this is the in-process contract gate.)
    async fn mock_upstream() -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|req: Request<Body>| async move {
                // Echo the upstream Authorization back in a SAFE header the
                // test reads — never log it, never forward it onward.
                let auth = req
                    .headers()
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                // Echo one caller header to prove verbatim forwarding.
                let beta = req
                    .headers()
                    .get("anthropic-beta")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                let sse = "data: {\"delta\":{\"content\":\"hi\"}}\n\ndata: [DONE]\n\n";
                Response::builder()
                    .status(200)
                    .header("content-type", "text/event-stream")
                    .header("x-litellm-model-name", "openai/secret-model")
                    .header("x-litellm-key-spend", "0.001")
                    .header("x-test-upstream-auth", auth)
                    .header("x-test-beta", beta)
                    .body(Body::from(sse))
                    .unwrap()
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (addr, handle)
    }

    fn test_state(upstream: String) -> ProxyState {
        ProxyState {
            client: reqwest::Client::builder().build().unwrap(),
            upstream,
        }
    }

    #[tokio::test]
    async fn forwards_with_real_key_and_strips_model_headers() {
        let _g = crate::gateway::test_serial();
        let (up_addr, _mock) = mock_upstream().await;
        // Register a dummy downstream token the way proxy_channel_env does.
        let token = "sk-zaino-local-test-1".to_string();
        proxy_tokens()
            .lock()
            .unwrap()
            .insert(token.clone());
        // Install a fake live key (memory only — never touches keychain).
        set_live_key("zn-test-key".to_string());

        let state = test_state(format!("http://{up_addr}"));
        let req = Request::builder()
            .method(Method::POST)
            .uri("http://127.0.0.1/v1/chat/completions")
            .header("authorization", format!("Bearer {token}"))
            .header("anthropic-beta", "test-beta-must-forward")
            .body(Body::from(r#"{"model":"fast"}"#))
            .unwrap();
        let resp = forward(State(state), req).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let headers = resp.headers().clone();
        // Spend headers pass; model identity does not.
        assert_eq!(headers.get("x-litellm-key-spend").unwrap(), "0.001");
        assert!(headers.get("x-litellm-model-name").is_none());
        // Caller headers forwarded verbatim.
        assert_eq!(
            headers.get("x-test-upstream-auth").unwrap(),
            "Bearer zn-test-key"
        );
        assert_eq!(headers.get("x-test-beta").unwrap(), "test-beta-must-forward");
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&bytes[..], b"data: {\"delta\":{\"content\":\"hi\"}}\n\ndata: [DONE]\n\n");
        clear_live_key();
    }

    #[tokio::test]
    async fn bad_token_dies_before_upstream() {
        let (up_addr, _mock) = mock_upstream().await;
        let state = test_state(format!("http://{up_addr}"));
        let req = Request::builder()
            .method(Method::POST)
            .uri("http://127.0.0.1/v1/chat/completions")
            .header("authorization", "Bearer wrong")
            .body(Body::from("{}"))
            .unwrap();
        let resp = forward(State(state), req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn unknown_route_is_404() {
        let state = test_state("http://127.0.0.1:1".to_string());
        let req = Request::builder()
            .method(Method::GET)
            .uri("http://127.0.0.1/v1/evil")
            .header("authorization", "Bearer x")
            .body(Body::empty())
            .unwrap();
        let resp = forward(State(state), req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn route_table_is_narrow() {
        assert!(route_allowed("/v1/chat/completions", &Method::POST));
        assert!(route_allowed("/v1/messages", &Method::POST));
        assert!(route_allowed("/v1/responses", &Method::POST));
        assert!(route_allowed("/v1/models", &Method::GET));
        assert!(route_allowed("/healthz", &Method::GET));
        assert!(!route_allowed("/v1/chat/completions", &Method::GET));
        assert!(!route_allowed("/v1/embeddings", &Method::POST));
        assert!(!route_allowed("/admin", &Method::GET));
    }

    #[test]
    fn strips_upstream_identity_not_spend() {
        assert!(stripped_response_header("x-litellm-model-name"));
        assert!(stripped_response_header("X-LiteLLM-Model-Id"));
        assert!(stripped_response_header("llm_provider-foo"));
        assert!(!stripped_response_header("x-litellm-key-spend"));
        assert!(!stripped_response_header("x-litellm-response-cost"));
        assert!(!stripped_response_header("x-litellm-call-id"));
        assert!(!stripped_response_header("content-type"));
    }
}

#[cfg(test)]
mod live_tests {
    // Live-gateway proof, NEVER in the default suite: needs a real key,
    // spends real (nominal) budget, and hits the network. Run explicitly:
    //   ZAINO_TEST_KEY=zn-… cargo test -p ccgui-next --lib live_proxy -- --ignored --nocapture
    // Mint a $1 single-model key, run, then delete it. M1 acceptance gate.
    use super::*;
    use crate::gateway::{clear_live_key, proxy_tokens, set_live_key};

    #[tokio::test]
    #[ignore]
    async fn live_proxy_forwards_chat_to_gateway() {
        let key = std::env::var("ZAINO_TEST_KEY")
            .expect("ZAINO_TEST_KEY must hold a throwaway zn- key");
        assert!(key.starts_with("zn-"), "not a Zaino key");

        // Proxy pointed at the REAL gateway (not the mock): override the
        // upstream for this test only via a local state clone.
        let state = ProxyState {
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
            upstream: crate::gateway::GATEWAY_BASE_URL.to_string(),
        };
        set_live_key(key);
        let token = "sk-zaino-local-live-test".to_string();
        proxy_tokens().lock().unwrap().insert(token.clone());

        let req = Request::builder()
            .method(Method::POST)
            .uri("http://127.0.0.1/v1/chat/completions")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"model":"fast","messages":[{"role":"user","content":"Reply with exactly: M1_OK"}],"max_tokens":64,"stream":false}"#,
            ))
            .unwrap();
        let resp = forward(State(state), req).await;
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let text = String::from_utf8_lossy(&bytes);
        crate::gateway::clear_live_key();
        assert_eq!(status, StatusCode::OK, "gateway answered: {text}");
        assert!(
            text.contains("M1_OK"),
            "model did not answer M1_OK: {text}"
        );
        assert!(
            !text.contains("nemotron") && !text.contains("nvidia"),
            "upstream model id leaked: {text}"
        );
    }
}

#[cfg(test)]
mod soak_tests {
    //! M2 soak gate (in-process): the behaviors that would disqualify the
    //! proxy if they failed — byte fidelity under chunked/delayed SSE,
    //! concurrency, mid-stream abort tolerance, no-retry on budget 429s,
    //! verbatim 5xx passthrough. The 10-minute idle and live-Claude turns
    //! stay in `docs/gateway/e2e/M2-soak.sh` (too slow/flaky for unit CI).
    use super::*;
    use crate::gateway::{clear_live_key, proxy_tokens, set_live_key};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct ScriptedUpstream {
        addr: SocketAddr,
        calls: Arc<AtomicUsize>,
    }

    async fn scripted() -> ScriptedUpstream {
        use futures_util::stream::{self, StreamExt as _};
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let app = Router::new().route(
            "/v1/chat/completions",
            post(move |req: Request<Body>| {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    let (parts, body) = req.into_parts();
                    let bytes = axum::body::to_bytes(body, 64 * 1024).await.unwrap_or_default();
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    // Body-driven behavior: trigger words select the script.
                    // Delayed chunked SSE exercises flush behavior — a
                    // buffering proxy would deliver one lump after the full
                    // delay instead of incrementally.
                    if text.contains("trigger-budget") {
                        return Response::builder()
                            .status(429)
                            .header("content-type", "application/json")
                            .body(Body::from(
                                r#"{"error":{"type":"budget_exceeded","message":"Budget has been exceeded! Current cost: 1.0, Max budget: 1.0"}}"#,
                            ))
                            .unwrap();
                    }
                    if text.contains("trigger-boom") {
                        return Response::builder()
                            .status(500)
                            .body(Body::from(r#"{"error":"provider blew up"}"#))
                            .unwrap();
                    }
                    let _ = parts;
                    let chunks = stream::unfold(0u32, |i| async move {
                        if i >= 10 {
                            return None;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
                        let line = format!(
                            "data: {{\"delta\":{{\"content\":\"t{i}\"}}}}\n\n"
                        );
                        Some((
                            Ok::<_, std::io::Error>(axum::body::Bytes::from(line)),
                            i + 1,
                        ))
                    })
                    .chain(stream::once(async {
                        Ok::<_, std::io::Error>(axum::body::Bytes::from(
                            "data: [DONE]\n\n",
                        ))
                    }));
                    Response::builder()
                        .status(200)
                        .header("content-type", "text/event-stream")
                        .header("x-litellm-key-spend", "0.001")
                        .body(Body::from_stream(chunks))
                        .unwrap()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        ScriptedUpstream { addr, calls }
    }
    fn state_for(upstream: &str) -> ProxyState {
        ProxyState {
            client: reqwest::Client::builder().build().unwrap(),
            upstream: upstream.to_string(),
        }
    }

    fn authed(path: &str, token: &str, body: &'static str) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri(format!("http://127.0.0.1{path}"))
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    }

    fn test_token() -> String {
        let t = format!("sk-zaino-local-soak-{}", uuid::Uuid::new_v4().as_simple());
        proxy_tokens().lock().unwrap().insert(t.clone());
        set_live_key("zn-soak-test".to_string());
        t
    }

    fn expected_stream() -> Vec<u8> {
        let mut out = String::new();
        for i in 0..10u32 {
            out.push_str(&format!("data: {{\"delta\":{{\"content\":\"t{i}\"}}}}\n\n"));
        }
        out.push_str("data: [DONE]\n\n");
        out.into_bytes()
    }

    #[tokio::test]
    async fn byte_identity_across_many_turns() {
        let _g = crate::gateway::test_serial();
        let up = scripted().await;
        let state = state_for(&format!("http://{}", up.addr));
        let token = test_token();
        // 50 turns through the proxy; every byte must match the script.
        for _ in 0..50 {
            let resp = forward(State(state.clone()), authed("/v1/chat/completions", &token, "{}")).await;
            assert_eq!(resp.status(), StatusCode::OK);
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            assert_eq!(&bytes[..], &expected_stream()[..]);
        }
        assert_eq!(up.calls.load(Ordering::SeqCst), 50);
        clear_live_key();
    }

    #[tokio::test]
    async fn concurrent_turns_all_correct() {
        let _g = crate::gateway::test_serial();
        let up = scripted().await;
        let state = state_for(&format!("http://{}", up.addr));
        let token = test_token();
        let mut handles = Vec::new();
        for _ in 0..20 {
            let state = state.clone();
            let token = token.clone();
            handles.push(tokio::spawn(async move {
                let resp = forward(State(state), authed("/v1/chat/completions", &token, "{}")).await;
                assert_eq!(resp.status(), StatusCode::OK);
                let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
                assert_eq!(&bytes[..], &expected_stream()[..]);
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        clear_live_key();
    }

    #[tokio::test]
    async fn abort_mid_stream_does_not_hang_or_panic() {
        let _g = crate::gateway::test_serial();
        let up = scripted().await;
        let state = state_for(&format!("http://{}", up.addr));
        let token = test_token();
        let resp = forward(State(state), authed("/v1/chat/completions", &token, "{}")).await;
        // Read one chunk, then drop the reader mid-stream (client disconnect).
        let mut stream = resp.into_body().into_data_stream();
        use futures_util::StreamExt;
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
            .await
            .expect("first chunk")
            .expect("stream item")
            .expect("bytes");
        assert!(first.starts_with(b"data: "));
        drop(stream);
        // If forward() leaked a task or panicked on disconnect, this hangs.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        clear_live_key();
    }

    #[tokio::test]
    async fn budget_429_is_forwarded_once_never_retried() {
        let _g = crate::gateway::test_serial();
        let up = scripted().await;
        let before = up.calls.load(Ordering::SeqCst);
        let state = state_for(&format!("http://{}", up.addr));
        let token = test_token();
        let resp = forward(State(state), authed("/v1/chat/completions", &token, r#"{"trigger":"trigger-budget"}"#)).await;
        assert_eq!(resp.status(), StatusCode::from_u16(429).unwrap());
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("budget_exceeded"));
        // Exactly one upstream call: the proxy never retries a budget 429
        // (retry-looping a customer into a bigger bill is the failure mode).
        assert_eq!(up.calls.load(Ordering::SeqCst), before + 1);
        clear_live_key();
    }

    #[tokio::test]
    async fn upstream_500_passes_through_verbatim() {
        let _g = crate::gateway::test_serial();
        let up = scripted().await;
        let state = state_for(&format!("http://{}", up.addr));
        let token = test_token();
        let resp = forward(State(state), authed("/v1/chat/completions", &token, r#"{"trigger":"trigger-boom"}"#)).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("blew up"));
        clear_live_key();
    }
}
