# Senior-Level Concepts — what this solution does and why

This doc maps each **industry-standard practice** in the streaming chat API to the
**exact code** that implements it, then explains **how it actually helps** and the
**interview angle**. File references use `app/main.py` etc. with line numbers.

---

## 1. TTFT — Time To First Token

**What:** The latency from "request received" to "first token sent to client." For
LLMs this is the metric users *feel* — far more than total time. A 12s answer that
starts appearing in 300ms feels fast; the same answer dumped at 12s feels broken.

**Where in code:** `app/main.py`, `event_source()`:
```python
start = time.perf_counter()        # line 57: clock starts before first token
first = True
...
if first:
    logger.info("ttft_ms=%d", int((time.perf_counter() - start) * 1000))  # line 66
    first = False
```

**How it helps:** We stamp the elapsed ms when the *first* chunk leaves. That number
shows in logs (`ttft_ms=...`). In production you ship it to App Insights and alert if
p95 TTFT regresses — e.g., a prompt change bloated context and TTFT doubled. Total
latency hides that; TTFT exposes it.

**Interview angle:** "Optimize TTFT, not just total latency. We log TTFT per request
and watch p95." Levers: smaller system prompt, stream immediately, warm deployments.

---

## 2. Streaming via SSE (Server-Sent Events)

**What:** One long-lived HTTP response that emits `data: ...\n\n` chunks as tokens
generate — the ChatGPT typing effect.

**Where:** `chat_stream` returns `StreamingResponse(event_source(), media_type="text/event-stream")`
(line 74); the async generator `yield`s `data: {json}\n\n` (line 68) and a terminal
`data: [DONE]` (line 69). Source tokens come from `provider.stream()` (line 60).

**How it helps:** Perceived latency collapses; works through plain HTTP (proxy/LB
friendly, unlike WebSockets). `[DONE]` gives the client a clean end signal.

**Interview angle:** "SSE vs WebSocket — SSE is one-way server→client, simpler, no
special infra. At scale, disable proxy buffering or chunks get held back."

---

## 3. Async — one worker serves many concurrent requests

**What:** The LLM is slow (seconds). `async def` + `await` lets one worker handle
other requests while a generation is in flight.

**Where:** Routes are `async def` (lines 49, 55); providers `await` real I/O (mock
`await asyncio.sleep`, Azure `await client...create`). `async for` over the stream
(line 60) yields control between chunks.

**How it helps:** 1 worker can hold many concurrent slow calls instead of freezing.

**Interview angle (the trap):** `async def` only helps if everything inside *awaits*.
A blocking SDK call in `async def` freezes the whole event loop. Fix: async client or
`asyncio.to_thread`. Sync `def` routes are safe — FastAPI runs them in a threadpool.

---

## 4. Timeout — bound the slow dependency

**Where:** `await asyncio.wait_for(provider.complete(req), timeout=_s.request_timeout_seconds)`
(line 51), value from `config.py` (default 30s).

**How it helps:** A hung upstream can't pin a worker forever; it raises and frees the
slot. Treat the LLM as unreliable: timeouts + retries + circuit breakers.

**Interview angle:** "Every external call gets a timeout; missing timeouts cause
cascading worker exhaustion."

---

## 5. Client-disconnect cancellation — stop paying for abandoned work

**Where:** `if await request.is_disconnected(): break` (line 62); `CancelledError`
handler (line 70).

**How it helps:** User refreshes/closes tab → we stop streaming → no tokens billed for
output nobody reads. Real cost saver at scale.

**Interview angle:** "30s call, user refreshes 5×" → de-dup, cancel, cap cost.

---

## 6. Swappable provider — program to an interface

**Where:** `LLMProvider` Protocol + `MockLLM`/`AzureOpenAIProvider` + `build_provider()`
(providers.py). App reads via `Depends(get_provider)` (main.py 39, 55).

**How it helps:** Offline/free/deterministic locally; one env var → real Azure. Tests
never call/pay the LLM. Lazy SDK import = no openai needed for mock.

---

## 7. Token budgeting & usage

**Where:** `max_tokens` capped 1–4096 (schemas.py); `Usage` returned by `complete`.
**How it helps:** Tokens = money + latency. Cap output, surface usage for cost tracking.

---

## 8. Lifespan, config, CORS, separate schemas
Provider built once on startup (lifespan, line 26); secrets via env not code; CORS not
`*` (line 34); input vs output models prevent leakage.

---

## Cheat sheet
TTFT logged 66 · SSE 74 · async 49/55 · timeout 51 · disconnect 62 · interface providers.py · budget schemas.py
