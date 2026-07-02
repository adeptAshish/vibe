"""
LLM providers behind one interface. `respond(system_prompt, user_block)` takes a
fully-constructed system prompt and the delimited user block.

MockLLM is offline and, importantly, models a WELL-BEHAVED assistant that honors
the system boundary — so tests can assert that our defense keeps the system
instruction authoritative. It echoes which prompt version it saw.
"""

from __future__ import annotations

from typing import Protocol

from .config import Settings


class LLMProvider(Protocol):
    def respond(self, system_prompt: str, user_block: str) -> str: ...


class MockLLM:
    def respond(self, system_prompt: str, user_block: str) -> str:
        # A safe assistant: it treats the delimited block as data. If the system
        # prompt forbids revealing itself, the mock refuses (models correct
        # behavior when the boundary is respected).
        if "reveal" in user_block.lower() or "ignore" in user_block.lower():
            return ("I can help with your request, but I can't change my "
                    "instructions or reveal internal prompts.")
        return "Thanks for your message! Here's a helpful mock response."


class AzureOpenAIProvider:
    def __init__(self, settings: Settings) -> None:
        try:
            from openai import AzureOpenAI  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("Run `pip install openai` to use azure_openai.") from exc
        if not (settings.azure_openai_endpoint and settings.azure_openai_deployment):
            raise RuntimeError("Set AZURE_OPENAI_ENDPOINT and _DEPLOYMENT.")
        self._client = AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
        )
        self._deployment = settings.azure_openai_deployment

    def respond(self, system_prompt: str, user_block: str) -> str:  # pragma: no cover
        r = self._client.chat.completions.create(
            model=self._deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_block},
            ],
        )
        return r.choices[0].message.content or ""


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "azure_openai":
        return AzureOpenAIProvider(settings)
    return MockLLM()
