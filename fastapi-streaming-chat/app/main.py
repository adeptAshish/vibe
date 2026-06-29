"""
FastAPI app: streaming + non-streaming chat.

Run: uvicorn app.main:app --reload  -> open /docs
"""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import get_settings
from .providers import LLMProvider, build_provider
from .schemas import ChatRequest, ChatResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.provider = build_provider(get_settings())
    yield


app = FastAPI(title="Streaming Chat API", version="0.1.0", lifespan=lifespan)
_s = get_settings()
app.add_middleware(
    CORSMiddleware, allow_origins=_s.cors_origins_list,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def get_provider() -> LLMProvider:
    return app.state.provider


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse, tags=["chat"])
async def chat(req: ChatRequest, provider: LLMProvider = Depends(get_provider)) -> ChatResponse:
    # Timeout: never let one slow generation hang a worker forever.
    return await asyncio.wait_for(provider.complete(req), timeout=_s.request_timeout_seconds)


@app.post("/chat/stream", tags=["chat"])
async def chat_stream(req: ChatRequest, request: Request, provider: LLMProvider = Depends(get_provider)) -> StreamingResponse:
    async def event_source():
        start = time.perf_counter()
        first = True
        try:
            async for chunk in provider.stream(req):
                # Client disconnect handling: stop "cooking" if user left.
                if await request.is_disconnected():
                    logger.info("client disconnected; aborting stream")
                    break
                if first:
                    logger.info("ttft_ms=%d", int((time.perf_counter() - start) * 1000))
                    first = False
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            logger.info("stream cancelled")
            raise

    return StreamingResponse(event_source(), media_type="text/event-stream")
