"""
Config — env-driven, validated. Default provider "mock" runs offline/free.
Flip to "azure_openai" + fill placeholders to use real function calling.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Tool Calling API"
    environment: Literal["local", "development", "production"] = "local"

    llm_provider: Literal["mock", "azure_openai"] = "mock"

    # Safety rail: hard cap on tool-calling loop iterations so a confused
    # model can never spin forever (cost + latency runaway protection).
    max_tool_iterations: int = 5
    request_timeout_seconds: float = 30.0

    # ---- Azure OpenAI placeholders (only for llm_provider=azure_openai) ----
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""
    azure_openai_api_version: str = "2024-10-21"

    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
