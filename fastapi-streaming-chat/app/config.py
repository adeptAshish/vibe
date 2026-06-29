"""
Config — env-driven, validated, secrets stay out of code (pydantic-settings).

Default provider is "mock" so the whole app runs offline/free. Flip to
"azure_openai" + fill the placeholders to use a real deployment.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Streaming Chat API"
    environment: Literal["local", "development", "production"] = "local"

    # mock -> deterministic, offline. azure_openai -> real deployment.
    llm_provider: Literal["mock", "azure_openai"] = "mock"

    # Treat the LLM as an unreliable, slow downstream dependency.
    request_timeout_seconds: float = 30.0

    # ---- Azure OpenAI placeholders (only for llm_provider=azure_openai) ----
    azure_openai_endpoint: str = ""        # https://<resource>.openai.azure.com
    azure_openai_api_key: str = ""         # prefer Managed Identity in prod
    azure_openai_deployment: str = ""      # your model deployment name
    azure_openai_api_version: str = "2024-10-21"

    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
