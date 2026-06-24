"""
FastAPI application entry point.

Run locally with:
    uvicorn app.main:app --reload

Then open http://127.0.0.1:8000/docs for interactive, auto-generated docs.
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .schemas import TaskCreate, TaskResponse, TaskUpdate
from .storage import TaskStore, build_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan handler — runs ONCE on startup and ONCE on shutdown.
    We build the storage backend here and stash it on app.state so every
    request reuses the same instance (e.g. one Azure Table client).
    """
    settings = get_settings()
    app.state.store = build_store(settings)
    yield
    # (Nothing to clean up for the in-memory backend.)


app = FastAPI(
    title="Task Manager API",
    description="A small CRUD API built with FastAPI to learn the framework + Azure.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware — controls which browser origins may call this API.
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,  # never "*" in real apps
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_store() -> TaskStore:
    """
    FastAPI dependency: hands the current request the shared TaskStore.

    Using Depends(get_store) instead of a global makes endpoints easy to test
    (you can override this dependency with a fake store).
    """
    return app.state.store


# --- Routes -------------------------------------------------------------
# A "tags" value groups these endpoints together in the /docs UI.


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe — handy for Azure App Service / Container Apps health checks."""
    return {"status": "ok"}


@app.get("/tasks", response_model=list[TaskResponse], tags=["tasks"])
def list_tasks(store: TaskStore = Depends(get_store)) -> list[TaskResponse]:
    return store.list()


@app.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,  # 201 = resource created
    tags=["tasks"],
)
def create_task(
    payload: TaskCreate, store: TaskStore = Depends(get_store)
) -> TaskResponse:
    return store.create(payload)


@app.get("/tasks/{task_id}", response_model=TaskResponse, tags=["tasks"])
def get_task(task_id: str, store: TaskStore = Depends(get_store)) -> TaskResponse:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return task


@app.patch("/tasks/{task_id}", response_model=TaskResponse, tags=["tasks"])
def update_task(
    task_id: str, payload: TaskUpdate, store: TaskStore = Depends(get_store)
) -> TaskResponse:
    task = store.update(task_id, payload)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return task


@app.delete(
    "/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,  # 204 = success, no body
    tags=["tasks"],
)
def delete_task(task_id: str, store: TaskStore = Depends(get_store)) -> None:
    if not store.delete(task_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
