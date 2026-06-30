"""
LLM providers behind one interface, for two capabilities:

  * extract(text, schema) -> a dict obeying the given JSON schema (structured output)
  * decide(messages, tools) -> either a ToolRequest (call a tool) or a FinalAnswer

MockLLM implements both deterministically/offline so the whole flow is testable
without a real model. AzureOpenAIProvider uses real Structured Outputs + function
calling. Swap via LLM_PROVIDER — the routes never change.
"""

from __future__ import annotations

import re
from typing import Protocol

from pydantic import BaseModel

from .config import Settings


# ----- Decision types returned by decide() ------------------------------
class ToolRequest(BaseModel):
    tool: str
    arguments: dict


class FinalAnswer(BaseModel):
    content: str


Decision = ToolRequest | FinalAnswer


class LLMProvider(Protocol):
    def extract(self, text: str, schema: dict) -> dict: ...
    def decide(self, messages: list[dict], tools: list[dict]) -> Decision: ...


class MockLLM:
    """Deterministic stand-in. Uses simple rules to mimic how a real model would
    pick tools / extract fields, so tests are reproducible and offline."""

    # --- structured output ---
    def extract(self, text: str, schema: dict) -> dict:
        t = text.lower()
        if any(w in t for w in ("charge", "refund", "invoice", "bill", "payment")):
            category = "billing"
        elif any(w in t for w in ("error", "crash", "bug", "broken", "login")):
            category = "technical"
        elif any(w in t for w in ("password", "account", "email")):
            category = "account"
        else:
            category = "other"

        if any(w in t for w in ("urgent", "asap", "immediately", "down")):
            priority = "urgent"
        elif any(w in t for w in ("soon", "important")):
            priority = "high"
        else:
            priority = "medium"

        sentiment = (
            "negative" if any(w in t for w in ("angry", "frustrat", "terrible", "worst"))
            else "positive" if any(w in t for w in ("thanks", "great", "love"))
            else "neutral"
        )
        return {
            "category": category,
            "priority": priority,
            "summary": text.strip()[:200],
            "customer_sentiment": sentiment,
        }

    # --- tool-calling decision ---
    def decide(self, messages: list[dict], tools: list[dict]) -> Decision:
        # If the last message is a tool result, produce a final answer.
        last = messages[-1]
        if last.get("role") == "tool":
            return FinalAnswer(content=f"Based on the tool result: {last['content']}")

        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        u = user.lower()

        # Rule-based tool selection mimicking a model's intent detection.
        city = re.search(r"weather in (\w+)", u)
        if city:
            return ToolRequest(tool="get_weather", arguments={"city": city.group(1)})

        order = re.search(r"order\s+([a-z]\d+)", u)
        if order:
            return ToolRequest(tool="search_orders", arguments={"order_id": order.group(1)})

        calc = re.search(r"(\d+\s*[-+*/]\s*\d+)", user)
        if calc:
            return ToolRequest(tool="calculate", arguments={"expression": calc.group(1)})

        return FinalAnswer(content="I don't have a tool for that, but I'm happy to help.")


class AzureOpenAIProvider:
    """Real Azure OpenAI: Structured Outputs (response_format=json_schema) +
    function calling. SDK imported lazily."""

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

    def extract(self, text: str, schema: dict) -> dict:  # pragma: no cover - needs Azure
        import json

        r = self._client.chat.completions.create(
            model=self._deployment,
            messages=[
                {"role": "system", "content": "Extract fields strictly per the schema."},
                {"role": "user", "content": text},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "extraction", "schema": schema, "strict": True},
            },
        )
        return json.loads(r.choices[0].message.content)

    def decide(self, messages: list[dict], tools: list[dict]) -> Decision:  # pragma: no cover
        r = self._client.chat.completions.create(
            model=self._deployment, messages=messages, tools=tools, tool_choice="auto",
        )
        msg = r.choices[0].message
        if msg.tool_calls:
            import json

            call = msg.tool_calls[0]
            return ToolRequest(tool=call.function.name, arguments=json.loads(call.function.arguments))
        return FinalAnswer(content=msg.content or "")


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "azure_openai":
        return AzureOpenAIProvider(settings)
    return MockLLM()
