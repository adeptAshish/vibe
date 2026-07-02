"""Request/response schemas."""

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    # Optional prompt version pin — lets a caller A/B test or roll back.
    prompt_version: str | None = None


class ChatResponse(BaseModel):
    answer: str
    prompt_name: str
    prompt_version: str
    injection_suspected: bool


class PromptInfo(BaseModel):
    name: str
    versions: list[str]


class RenderedPrompt(BaseModel):
    name: str
    version: str
    system_prompt: str
    required_vars: list[str]
