"""
FastAPI app: prompt engineering as code.

Endpoints
  GET  /prompts              -> catalog of prompt names + versions
  GET  /prompts/{name}       -> render a prompt (with trusted vars) to inspect it
  POST /chat                 -> chat using a versioned prompt + injection-safe
                                handling of the user message

Run: uvicorn app.main:app --reload -> open /docs
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .prompts import PromptRegistry, build_registry
from .providers import LLMProvider, build_provider
from .schemas import ChatRequest, ChatResponse, PromptInfo, RenderedPrompt
from .security import wrap_user_input

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("prompt")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.registry = build_registry()
    app.state.provider = build_provider(get_settings())
    yield


app = FastAPI(title="Prompt Engineering API", version="0.1.0", lifespan=lifespan)
_s = get_settings()
app.add_middleware(
    CORSMiddleware, allow_origins=_s.cors_origins_list,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def get_registry() -> PromptRegistry:
    return app.state.registry


def get_provider() -> LLMProvider:
    return app.state.provider


def _trusted_vars(s: Settings) -> dict[str, str]:
    """The ONLY values allowed into a prompt template — all trusted config,
    never user input."""
    return {
        "company_name": s.company_name,
        "assistant_name": s.assistant_name,
        "domain": s.domain,
        "tone": s.tone,
    }


def _render_system_prompt(reg: PromptRegistry, s: Settings, version: str | None) -> tuple[str, str, str]:
    tmpl = reg.get(s.default_prompt, version or s.default_prompt_version)
    # Only pass the variables THIS template needs (templates differ by version).
    needed = {k: v for k, v in _trusted_vars(s).items() if k in tmpl.required_vars}
    return tmpl.render(**needed), tmpl.name, tmpl.version


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/prompts", response_model=list[PromptInfo], tags=["prompts"])
def list_prompts(reg: PromptRegistry = Depends(get_registry)) -> list[PromptInfo]:
    return [PromptInfo(name=n, versions=v) for n, v in reg.catalog().items()]


@app.get("/prompts/{name}", response_model=RenderedPrompt, tags=["prompts"])
def show_prompt(
    name: str,
    version: str | None = Query(default=None),
    reg: PromptRegistry = Depends(get_registry),
    s: Settings = Depends(get_settings),
) -> RenderedPrompt:
    try:
        tmpl = reg.get(name, version)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    needed = {k: v for k, v in _trusted_vars(s).items() if k in tmpl.required_vars}
    return RenderedPrompt(
        name=tmpl.name, version=tmpl.version,
        system_prompt=tmpl.render(**needed),
        required_vars=sorted(tmpl.required_vars),
    )


@app.post("/chat", response_model=ChatResponse, tags=["chat"])
def chat(
    req: ChatRequest,
    reg: PromptRegistry = Depends(get_registry),
    provider: LLMProvider = Depends(get_provider),
    s: Settings = Depends(get_settings),
) -> ChatResponse:
    # 1. Build the system prompt from a VERSIONED template (trusted vars only).
    try:
        system_prompt, name, version = _render_system_prompt(reg, s, req.prompt_version)
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"prompt error: {e}")

    # 2. Handle the user message through the injection guard: delimit + neutralize
    #    breakout + detect. User text NEVER touches the instruction body.
    sanitized = wrap_user_input(req.message)
    if sanitized.injection_suspected:
        logger.warning("possible prompt injection: signals=%s", sanitized.matched_signals)

    # 3. Call the model with clean separation of instructions vs data.
    answer = provider.respond(system_prompt, sanitized.wrapped)

    return ChatResponse(
        answer=answer, prompt_name=name, prompt_version=version,
        injection_suspected=sanitized.injection_suspected,
    )
