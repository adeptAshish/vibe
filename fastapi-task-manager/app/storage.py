"""
Storage abstraction.

We define a small `TaskStore` interface and provide two implementations:

  * InMemoryTaskStore  -> default; zero setup, data lives in RAM (great for
                          local dev and tests). Data is lost on restart.
  * AzureTableTaskStore -> persists to Azure Table Storage. This is a working
                          reference implementation but it only activates when
                          STORAGE_BACKEND=azure_table and a connection string
                          is provided. It imports the Azure SDK lazily so the
                          app runs locally without the SDK installed.

Swapping backends is a config change only (see config.py / .env), which is the
whole point of programming to an interface.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Protocol

from .config import Settings
from .schemas import TaskCreate, TaskResponse, TaskUpdate


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TaskStore(Protocol):
    """The contract every storage backend must satisfy."""

    def list(self) -> list[TaskResponse]: ...
    def get(self, task_id: str) -> TaskResponse | None: ...
    def create(self, data: TaskCreate) -> TaskResponse: ...
    def update(self, task_id: str, data: TaskUpdate) -> TaskResponse | None: ...
    def delete(self, task_id: str) -> bool: ...


class InMemoryTaskStore:
    """Default backend. A simple dict keyed by task id."""

    def __init__(self) -> None:
        self._tasks: dict[str, TaskResponse] = {}

    def list(self) -> list[TaskResponse]:
        return sorted(self._tasks.values(), key=lambda t: t.created_at)

    def get(self, task_id: str) -> TaskResponse | None:
        return self._tasks.get(task_id)

    def create(self, data: TaskCreate) -> TaskResponse:
        now = _now()
        task = TaskResponse(
            id=str(uuid.uuid4()),
            completed=False,
            created_at=now,
            updated_at=now,
            **data.model_dump(),
        )
        self._tasks[task.id] = task
        return task

    def update(self, task_id: str, data: TaskUpdate) -> TaskResponse | None:
        existing = self._tasks.get(task_id)
        if existing is None:
            return None
        # exclude_unset=True -> only overwrite fields the client actually sent.
        changes = data.model_dump(exclude_unset=True)
        updated = existing.model_copy(update={**changes, "updated_at": _now()})
        self._tasks[task_id] = updated
        return updated

    def delete(self, task_id: str) -> bool:
        return self._tasks.pop(task_id, None) is not None


class AzureTableTaskStore:
    """
    Azure Table Storage backend.

    Reference implementation — see docs/AZURE_INTEGRATION.md for setup.
    The azure-data-tables import is done inside __init__ so that this module
    never fails to import on a machine without the SDK installed.
    """

    def __init__(self, settings: Settings) -> None:
        try:
            from azure.data.tables import TableServiceClient  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on optional dep
            raise RuntimeError(
                "azure-data-tables is not installed. Run "
                "`pip install azure-data-tables` to use the azure_table backend."
            ) from exc

        if not settings.azure_storage_connection_string:
            raise RuntimeError(
                "AZURE_STORAGE_CONNECTION_STRING is empty. Set it in your "
                "environment (or Azure App Settings / Key Vault) to use the "
                "azure_table backend."
            )

        service = TableServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
        self._table_name = settings.azure_table_name
        service.create_table_if_not_exists(self._table_name)
        self._table = service.get_table_client(self._table_name)
        # All tasks share one partition for simplicity in this learning project.
        self._partition = "task"

    # --- mapping helpers between our schema and Azure Table entities --------
    def _to_entity(self, task: TaskResponse) -> dict:
        return {
            "PartitionKey": self._partition,
            "RowKey": task.id,
            "title": task.title,
            "description": task.description or "",
            "priority": task.priority.value,
            "completed": task.completed,
            "created_at": task.created_at.isoformat(),
            "updated_at": task.updated_at.isoformat(),
        }

    def _to_task(self, entity: dict) -> TaskResponse:
        return TaskResponse(
            id=entity["RowKey"],
            title=entity["title"],
            description=entity.get("description") or None,
            priority=entity["priority"],
            completed=entity["completed"],
            created_at=datetime.fromisoformat(entity["created_at"]),
            updated_at=datetime.fromisoformat(entity["updated_at"]),
        )

    def list(self) -> list[TaskResponse]:
        tasks = [self._to_task(e) for e in self._table.list_entities()]
        return sorted(tasks, key=lambda t: t.created_at)

    def get(self, task_id: str) -> TaskResponse | None:
        from azure.core.exceptions import ResourceNotFoundError  # type: ignore

        try:
            entity = self._table.get_entity(self._partition, task_id)
        except ResourceNotFoundError:
            return None
        return self._to_task(entity)

    def create(self, data: TaskCreate) -> TaskResponse:
        now = _now()
        task = TaskResponse(
            id=str(uuid.uuid4()),
            completed=False,
            created_at=now,
            updated_at=now,
            **data.model_dump(),
        )
        self._table.create_entity(self._to_entity(task))
        return task

    def update(self, task_id: str, data: TaskUpdate) -> TaskResponse | None:
        existing = self.get(task_id)
        if existing is None:
            return None
        changes = data.model_dump(exclude_unset=True)
        updated = existing.model_copy(update={**changes, "updated_at": _now()})
        self._table.update_entity(self._to_entity(updated), mode="replace")
        return updated

    def delete(self, task_id: str) -> bool:
        from azure.core.exceptions import ResourceNotFoundError  # type: ignore

        try:
            self._table.delete_entity(self._partition, task_id)
        except ResourceNotFoundError:
            return False
        return True


def build_store(settings: Settings) -> TaskStore:
    """Factory that picks a backend based on configuration."""
    if settings.storage_backend == "azure_table":
        return AzureTableTaskStore(settings)
    return InMemoryTaskStore()
