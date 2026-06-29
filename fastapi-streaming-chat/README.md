# Streaming Chat API (FastAPI + Azure OpenAI)

Phase 1.1 of the AI roadmap. A production-shaped LLM chat service demonstrating
**async streaming (SSE)**, timeouts, client-disconnect handling, token usage,
and a swappable provider. Runs **100% offline** with a `MockLLM`; flip one env
var to use **Azure OpenAI**.

## Concepts shown
| Concept | Where |
|---|---|
| Async I/O (one worker, many requests) | `app/main.py` async routes |
| SSE streaming + TTFT logging | `chat_stream` in `main.py` |
| Client-disconnect cancellation | `request.is_disconnected()` |
| Timeout on slow LLM | `asyncio.wait_for` |
| Swappable provider (mock/Azure) | `app/providers.py` |
| Token budgeting | `max_tokens` in `schemas.py` |

> 📘 **Industry standards deep-dive:** see [`docs/INDUSTRY_STANDARDS.md`](docs/INDUSTRY_STANDARDS.md) — every practice mapped to exact code + why it helps + interview angle.

## Run
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload   # open http://127.0.0.1:8000/docs
```
Stream test: `curl -N -X POST http://127.0.0.1:8000/chat/stream -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"`

## Tests
```powershell
pytest
```

## Azure OpenAI
See `docs/AZURE_INTEGRATION.md`. Set `LLM_PROVIDER=azure_openai` + endpoint/deployment.
