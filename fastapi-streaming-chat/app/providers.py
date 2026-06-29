"""
LLM providers behind one async interface.

  * stream(...) -> async generator yielding text chunks (tokens) — the SSE source
  * complete(...) -> a single full response with usage

MockLLM is deterministic + offline (free). AzureOpenAIProvider talks to a real
deployment. Swap via LLM_PROVIDER env var — the API code never changes.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator, Protocol

from .config import Settings
from .schemas import ChatRequest, ChatResponse, Usage


def _estimate_tokens(text: str) -> int:
    # Rough heuristic (~4 chars/token) — fine for a learning project.
    return max(1, len(text) // 4)


class LLMProvider(Protocol):
    async def stream(self, req: ChatRequest) -> AsyncIterator[str]: ...
    async def complete(self, req: ChatRequest) -> ChatResponse: ...


class MockLLM:
    """Deterministic, offline. Streams a canned reply token-by-token with a
    small delay so you can SEE streaming work locally."""

    def __init__(self, delay: float = 0.04) -> None:
        self._delay = delay

    def _reply(self, req: ChatRequest) -> str:
        last = req.messages[-1].content
        return (
            f"You said: '{last}'. This is a mock streamed response that arrives "
            "one token at a time so you can observe Server-Sent Events."
        )

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        for word in self._reply(req).split(" "):
            await asyncio.sleep(self._delay)  # simulate generation latency
            yield word + " "

    async def complete(self, req: ChatRequest) -> ChatResponse:
        text = self._reply(req)
        prompt = sum(_estimate_tokens(m.content) for m in req.messages)
        comp = _estimate_tokens(text)
        return ChatResponse(
            content=text,
            usage=Usage(prompt_tokens=prompt, completion_tokens=comp, total_tokens=prompt + comp),
        )


class AzureOpenAIProvider:
    """Real Azure OpenAI. SDK imported lazily so the app runs without it."""

    def __init__(self, settings: Settings) -> None:
        try:
            from openai import AsyncAzureOpenAI  # type: ignore
        except ImportError as exc:  # pragma: no cover - optional dep
            raise RuntimeError("Run `pip install openai` to use azure_openai.") from exc
        if not (settings.azure_openai_endpoint and settings.azure_openai_deployment):
            raise RuntimeError("Set AZURE_OPENAI_ENDPOINT and _DEPLOYMENT.")
        self._client = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
        )
        self._deployment = settings.azure_openai_deployment

    def _msgs(self, req: ChatRequest) -> list[dict]:
        return [{"role": m.role.value, "content": m.content} for m in req.messages]

    async def stream(self, req: ChatRequest) -> AsyncIterator[str]:
        s = await self._client.chat.completions.create(
            model=self._deployment, messages=self._msgs(req),
            max_tokens=req.max_tokens, stream=True,
        )
        async for chunk in s:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def complete(self, req: ChatRequest) -> ChatResponse:
        r = await self._client.chat.completions.create(
            model=self._deployment, messages=self._msgs(req), max_tokens=req.max_tokens,
        )
        u = r.usage
        return ChatResponse(
            content=r.choices[0].message.content or "",
            usage=Usage(prompt_tokens=u.prompt_tokens, completion_tokens=u.completion_tokens, total_tokens=u.total_tokens),
        )


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "azure_openai":
        return AzureOpenAIProvider(settings)
    return MockLLM()
