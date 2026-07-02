"""
Config — env-driven. Default provider "mock" runs offline.
`default_prompt_version` lets you pin/roll back the prompt in production without
a code change (prompts are versioned artifacts).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Prompt Engineering API"
    environment: Literal["local", "development", "production"] = "local"
    llm_provider: Literal["mock", "azure_openai"] = "mock"

    # Prompt selection (versioned). Change this to roll forward/back safely.
    default_prompt: str = "support_agent"
    default_prompt_version: str = "v2"

    # Trusted template variables (NOT user input) injected into the system prompt.
    company_name: str = "Acme Corp"
    assistant_name: str = "Ava"
    domain: str = "billing and account"
    tone: str = "friendly"

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
