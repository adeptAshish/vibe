"""
FastAPI app: structured outputs (/extract) + tool-calling loop (/agent).

Run: uvicorn app.main:app --reload  -> open /docs
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .providers import FinalAnswer, LLMProvider, ToolRequest, build_provider
from .schemas import (
    AgentRequest,
    AgentResponse,
    ExtractRequest,
    SupportTicket,
    ToolCallTrace,
)
from .tools import ToolRegistry, build_default_registry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tools")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.provider = build_provider(get_settings())
    app.state.registry = build_default_registry()
    yield


app = FastAPI(title="Tool Calling API", version="0.1.0", lifespan=lifespan)
_s = get_settings()
app.add_middleware(
    CORSMiddleware, allow_origins=_s.cors_origins_list,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def get_provider() -> LLMProvider:
    return app.state.provider


def get_registry() -> ToolRegistry:
    return app.state.registry


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=SupportTicket, tags=["structured"])
def extract(req: ExtractRequest, provider: LLMProvider = Depends(get_provider)) -> SupportTicket:
    """Structured output: free text -> strict schema. We STILL validate the
    model's JSON with Pydantic (defense in depth) before trusting it."""
    raw = provider.extract(req.text, SupportTicket.model_json_schema())
    try:
        return SupportTicket(**raw)  # rejects anything off-schema
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"model returned invalid data: {e}")


@app.post("/agent", response_model=AgentResponse, tags=["agent"])
def agent(
    req: AgentRequest,
    provider: LLMProvider = Depends(get_provider),
    registry: ToolRegistry = Depends(get_registry),
) -> AgentResponse:
    """The tool-calling loop — the foundation of every agent.

    The model only REQUESTS tools; our code validates + executes them and feeds
    results back. A hard max-iterations cap prevents infinite/expensive loops.
    """
    messages: list[dict] = [
        {"role": "system", "content": "You are a helpful assistant with tools."},
        {"role": "user", "content": req.question},
    ]
    trace: list[ToolCallTrace] = []
    max_iters = _s.max_tool_iterations

    for i in range(1, max_iters + 1):
        decision = provider.decide(messages, registry.specs())

        if isinstance(decision, FinalAnswer):
            return AgentResponse(answer=decision.content, tool_calls=trace, iterations=i)

        if isinstance(decision, ToolRequest):
            # Execute via the registry — the ONLY place tools run (allow-list +
            # arg validation live there).
            result = registry.execute(decision.tool, decision.arguments)
            trace.append(ToolCallTrace(tool=decision.tool, arguments=decision.arguments, result=result))
            logger.info("iter=%d tool=%s args=%s", i, decision.tool, decision.arguments)
            # Append assistant's request + the tool result so the model can continue.
            messages.append({"role": "assistant", "content": f"call {decision.tool}"})
            messages.append({"role": "tool", "content": result})

    # Hit the cap without a final answer -> degrade gracefully, don't hang.
    return AgentResponse(
        answer="Reached max tool iterations without a final answer.",
        tool_calls=trace,
        iterations=max_iters,
    )
