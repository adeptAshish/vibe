# Structured Outputs + Tool Calling API (FastAPI + Azure OpenAI)

Phase 1.2 of the AI roadmap. Two capabilities every production LLM system needs:

- **`POST /extract`** — *structured output*: free text → strict Pydantic schema
  (a support ticket: `category`, `priority`, `summary`, `sentiment`).
- **`POST /agent`** — *tool-calling loop*: the model requests tools
  (`get_weather`, `calculate`, `search_orders`); our code validates + executes
  them and feeds results back until a final answer. This loop is the foundation
  of every agent (Phase 3).

Runs **100% offline** with a deterministic `MockLLM`; flip `LLM_PROVIDER=azure_openai`
to use real Structured Outputs + function calling.

## Concepts shown
| Concept | Where |
|---|---|
| Structured output → strict schema | `app/schemas.py` `SupportTicket`, `/extract` |
| Output validation (defense in depth) | `SupportTicket(**raw)` in `main.py` |
| Tool registry = security boundary | `app/tools.py` |
| Arg validation firewall | `ToolRegistry.execute` |
| Allow-list (unknown tool refused) | `ToolRegistry.execute` |
| Injection-safe calculator (no `eval`) | `_safe_calc` in `tools.py` |
| Tool-calling loop | `/agent` in `app/main.py` |
| Max-iterations safety rail | `MAX_TOOL_ITERATIONS` |
| Swappable provider (mock/Azure) | `app/providers.py` |

> 📘 **Industry standards deep-dive:** see [`docs/INDUSTRY_STANDARDS.md`](docs/INDUSTRY_STANDARDS.md).

## Run
```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload   # open http://127.0.0.1:8000/docs
```

Examples:
```powershell
curl -X POST http://127.0.0.1:8000/extract -H "Content-Type: application/json" -d "{\"text\":\"charged twice, urgent refund!\"}"
curl -X POST http://127.0.0.1:8000/agent   -H "Content-Type: application/json" -d "{\"question\":\"weather in paris?\"}"
```

## Tests
```powershell
pytest
```

## Azure
See [`docs/AZURE_INTEGRATION.md`](docs/AZURE_INTEGRATION.md).
