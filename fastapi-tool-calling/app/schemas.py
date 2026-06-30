"""
Schemas.

Two families:
  * Structured-output target (SupportTicket) — the strict "form" the LLM must
    fill when we extract structured data from free text.
  * Agent I/O (AgentRequest/AgentResponse + ToolCallTrace) — for the
    tool-calling loop, including a trace so callers can SEE what the model did.
"""

from enum import Enum

from pydantic import BaseModel, Field


# ----- Structured output target -----------------------------------------
class Category(str, Enum):
    billing = "billing"
    technical = "technical"
    account = "account"
    other = "other"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class SupportTicket(BaseModel):
    """The strict shape we force the model to return from /extract.

    Separate, explicit fields with enums = the model cannot return prose; it
    must emit valid, parseable, type-safe data our systems can act on."""

    category: Category
    priority: Priority
    summary: str = Field(..., min_length=1, max_length=300)
    customer_sentiment: str = Field(..., description="one of: positive/neutral/negative")


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


# ----- Agent (tool-calling) I/O -----------------------------------------
class AgentRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)


class ToolCallTrace(BaseModel):
    """One step in the loop — what tool the model asked for, with what args,
    and what our code returned. Observability for a non-deterministic flow."""

    tool: str
    arguments: dict
    result: str


class AgentResponse(BaseModel):
    answer: str
    tool_calls: list[ToolCallTrace]
    iterations: int
