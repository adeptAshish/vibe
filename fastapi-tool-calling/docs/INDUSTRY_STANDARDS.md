# Industry Standards — what this solution does and why

Maps each industry-standard practice in this Structured Outputs + Tool Calling
service to the **exact code**, explains **how it helps**, and gives the
**interview angle**. References use `app/...` with the relevant symbol/line.

---

## 1. Structured Outputs — force the model to fill a form, not shout prose

**What:** Instead of free text, the model must return data matching a strict JSON
schema, so downstream code can parse it deterministically.

**Where:** `/extract` in `app/main.py` passes `SupportTicket.model_json_schema()`
to `provider.extract(...)`. The real provider (`providers.py`
`AzureOpenAIProvider.extract`) uses
`response_format={"type":"json_schema", ... "strict": True}` — Azure OpenAI
Structured Outputs, which *guarantees* schema-valid JSON via constrained decoding.

**How it helps:** Turns the LLM from a chat toy into a component inside a software
pipeline. No regex-scraping prose; no "about forty-two USD-ish".

**Interview angle:** Know the ladder — *prompt-and-pray* < *JSON mode* (tries to
emit JSON) < *Structured Outputs* (schema guaranteed). And still validate (below).

---

## 2. Output validation — defense in depth (never trust, even structured)

**Where:** `app/main.py` `/extract` does `SupportTicket(**raw)` inside try/except,
returning **502** if the model's data is off-schema.

**How it helps:** Even "guaranteed" outputs can drift (provider bugs, older models,
the mock). Re-validating with Pydantic means bad data fails fast at the boundary
instead of corrupting downstream systems.

**Interview angle:** "Schema enforcement at the model AND validation at the app —
two layers. The app never trusts the model blindly."

---

## 3. Tool registry — the security boundary (the LLM never executes)

**What:** A single place where tools are defined, allow-listed, and run. The model
only *names* a tool + args; it cannot run code.

**Where:** `app/tools.py` `ToolRegistry.execute()` is the ONLY execution path.
The `/agent` loop calls `registry.execute(decision.tool, decision.arguments)`.

**How it helps:** Centralizes the trust boundary. The model proposing
`delete_user(5)` means nothing unless `delete_user` is registered AND args pass
validation AND (in real systems) the caller is authorized.

**Interview angle:** "The LLM decides; the application executes. That boundary is
the whole security model of agents." Tool calling is where prompt injection turns
into *actions*, so this is where you gate it.

---

## 4. Argument validation firewall — untrusted input

**Where:** `ToolRegistry.execute` does `tool.args_model(**raw_args)` (Pydantic)
before running; on `ValidationError` it returns an error string, never executes.
Test: `test_registry_validates_arguments`.

**How it helps:** Tool args are attacker-influencable (via prompt injection / the
model). Validate type/length/range BEFORE touching any real system.

---

## 5. Allow-list — refuse hallucinated tools

**Where:** `ToolRegistry.execute` returns `error: unknown tool '...'` if the name
isn't registered. Test: `test_registry_rejects_unknown_tool`.

**How it helps:** Models sometimes invent tools. An allow-list makes that a safe
no-op instead of an error path or, worse, dynamic dispatch.

---

## 6. Injection-safe calculator — no eval()

**Where:** `app/tools.py` `_safe_calc` parses with `ast` and only permits
`+ - * /` on numeric literals — never `eval()`. Test:
`test_calculate_is_injection_safe` (`__import__('os')` is safely rejected).

**How it helps:** A naive `eval(expression)` tool is remote code execution handed
to whoever can influence the prompt. The ast-walk is the safe pattern.

**Interview angle:** Classic "spot the RCE" — a calculator tool using `eval` is a
critical vuln in LLM apps.

---

## 7. The tool-calling loop — foundation of agents

**Where:** `/agent` in `app/main.py`: build messages → `provider.decide()` →
if `ToolRequest`, execute + append result + continue; if `FinalAnswer`, return.

**How it helps:** This request→decide→act→feedback cycle IS what an "agent" is.
Owning the loop (not a black-box SDK) means you control cost, retries, and safety.

**Interview angle:** Be able to draw the 5-step loop and say where you'd add
authorization, parallel tool calls, and observability.

---

## 8. Max-iterations safety rail — runaway protection

**Where:** `for i in range(1, max_iters + 1)` in `/agent`, `max_iters` from
`config.py` `MAX_TOOL_ITERATIONS`. On cap, returns a graceful message.

**How it helps:** A confused model can loop forever (tool → tool → tool…), burning
money and latency. The cap bounds worst-case cost and guarantees termination.

**Interview angle:** "Every agent loop needs a hard iteration/cost cap + graceful
degradation. Unbounded loops are a production incident waiting to happen."

---

## 9. Observability — trace the non-deterministic flow

**Where:** `AgentResponse.tool_calls` (a `ToolCallTrace` per step) + `iterations`
returned to the caller; `logger.info("iter=%d tool=%s ...")` in the loop.

**How it helps:** You can SEE exactly what the model did (which tools, what args,
what results, how many steps) — essential for debugging and evals.

---

## 10. Swappable provider — offline, free, testable

**Where:** `providers.py` `LLMProvider` Protocol + `MockLLM` / `AzureOpenAIProvider`
+ `build_provider`. Mock makes deterministic tool/extraction decisions so tests
never call or pay a real model.

---

## Cheat sheet
structured-output `/extract`+`SupportTicket` · validate `SupportTicket(**raw)` ·
registry boundary `tools.py:execute` · arg firewall `args_model(**raw_args)` ·
allow-list unknown-tool · no-eval `_safe_calc` · loop `/agent` · cap
`MAX_TOOL_ITERATIONS` · trace `ToolCallTrace` · provider swap `providers.py`
