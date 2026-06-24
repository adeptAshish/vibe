"""
Application configuration.

We use pydantic-settings so configuration is read from environment variables
(and an optional .env file) and validated just like request data. This is the
idiomatic FastAPI way to handle config and keeps secrets OUT of source code.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Tells pydantic-settings to load a local .env file if present.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ---- General -------------------------------------------------------
    app_name: str = "Task Manager API"
    environment: Literal["local", "development", "production"] = "local"

    # ---- Storage backend ----------------------------------------------
    # "memory" -> runs locally with zero setup (data lives in RAM).
    # "azure_table" -> persists to Azure Table Storage (requires the
    #                  connection string below + `pip install azure-data-tables`).
    storage_backend: Literal["memory", "azure_table"] = "memory"

    # ---- Azure placeholders (only needed when storage_backend=azure_table)
    # Leave blank for local development. Fill these in (ideally via Azure
    # Key Vault / App Settings, never hardcoded) once you have a subscription.
    azure_storage_connection_string: str = ""
    azure_table_name: str = "tasks"

    # ---- CORS ----------------------------------------------------------
    # Comma-separated list of allowed origins. We deliberately AVOID "*"
    # so the API is not callable from arbitrary websites.
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so we build Settings once per process."""
    return Settings()
