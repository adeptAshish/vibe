# Task Manager API (FastAPI)

A small CRUD API built to **learn FastAPI** and how it integrates with Azure.
It runs **100% locally with zero Azure subscription** (in-memory storage) and
includes ready-to-use Azure integration code + docs for when you have a
subscription.

## What you'll learn here

| FastAPI concept | Where to look |
|-----------------|---------------|
| App + routing | `app/main.py` |
| Pydantic validation & separate input/output schemas | `app/schemas.py` |
| Dependency injection (`Depends`) | `get_store` in `app/main.py` |
| Config via env vars (`pydantic-settings`) | `app/config.py` |
| Lifespan startup/shutdown | `lifespan` in `app/main.py` |
| Programming to an interface (swappable storage) | `app/storage.py` |
| Auto-generated docs | run the app, open `/docs` |
| Testing with `TestClient` | `tests/test_tasks.py` |

## Endpoints

| Method | Path | Purpose | Success code |
|--------|------|---------|--------------|
| GET | `/health` | Liveness probe | 200 |
| GET | `/tasks` | List all tasks | 200 |
| POST | `/tasks` | Create a task | 201 |
| GET | `/tasks/{id}` | Get one task | 200 |
| PATCH | `/tasks/{id}` | Partially update a task | 200 |
| DELETE | `/tasks/{id}` | Delete a task | 204 |

## Run it locally

```powershell
# 1. From this folder, create & activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. (optional) copy env template
copy .env.example .env

# 4. Start the dev server (auto-reloads on code changes)
uvicorn app.main:app --reload
```

Now open:

- Interactive docs (Swagger UI): http://127.0.0.1:8000/docs
- Alternative docs (ReDoc): http://127.0.0.1:8000/redoc
- Health check: http://127.0.0.1:8000/health

### Try it from the command line

```powershell
# Create a task
curl -X POST http://127.0.0.1:8000/tasks -H "Content-Type: application/json" -d "{\"title\": \"Learn FastAPI\", \"priority\": \"high\"}"

# List tasks
curl http://127.0.0.1:8000/tasks
```

## Run the tests

```powershell
pip install -r requirements.txt
pytest
```

## Switching to Azure storage (later)

This project defaults to in-memory storage. To persist data in Azure Table
Storage, see **[docs/AZURE_INTEGRATION.md](docs/AZURE_INTEGRATION.md)**. In
short, you only change configuration — no code changes:

```env
STORAGE_BACKEND=azure_table
AZURE_STORAGE_CONNECTION_STRING=<your connection string>
```

## Project layout

```
fastapi-task-manager/
├── app/
│   ├── config.py     # settings (env-driven) + Azure placeholders
│   ├── schemas.py    # Pydantic models (separate input/output)
│   ├── storage.py    # in-memory + Azure Table backends behind one interface
│   └── main.py       # FastAPI app & routes
├── tests/
│   └── test_tasks.py
├── docs/
│   └── AZURE_INTEGRATION.md
├── requirements.txt
└── .env.example
```
