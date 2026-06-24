"""
Pydantic schemas (a.k.a. "models").

SECURITY NOTE — separate input and output schemas:
  * TaskCreate / TaskUpdate define what a client is ALLOWED to send.
  * TaskResponse defines what we send BACK.
This separation prevents two common API vulnerabilities:
  1. Mass assignment / over-posting (a client setting fields it shouldn't,
     e.g. server-managed ids or timestamps).
  2. Sensitive data exposure (accidentally returning internal fields).
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TaskBase(BaseModel):
    # Field(...) lets us attach validation + documentation that shows up in /docs.
    title: str = Field(..., min_length=1, max_length=200, examples=["Buy groceries"])
    description: str | None = Field(
        default=None, max_length=2000, examples=["Milk, eggs, bread"]
    )
    priority: Priority = Field(default=Priority.medium)


class TaskCreate(TaskBase):
    """Body accepted by POST /tasks. Note: no id/timestamps/completed here —
    those are server-controlled."""


class TaskUpdate(BaseModel):
    """Body accepted by PATCH /tasks/{id}. All fields optional so callers can
    update just what they need (partial update)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    priority: Priority | None = None
    completed: bool | None = None


class TaskResponse(TaskBase):
    """What we return to clients."""

    id: str
    completed: bool
    created_at: datetime
    updated_at: datetime
