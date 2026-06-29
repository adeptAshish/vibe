"""Request/response schemas. Separate input vs output (no leakage)."""

from enum import Enum

from pydantic import BaseModel, Field


class Role(str, Enum):
    system = "system"
    user = "user"
    assistant = "assistant"


class Message(BaseModel):
    role: Role
    content: str = Field(..., min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., min_length=1)
    # Token budgeting: cap output so cost/latency stay bounded.
    max_tokens: int = Field(default=256, ge=1, le=4096)


class Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    content: str
    usage: Usage
