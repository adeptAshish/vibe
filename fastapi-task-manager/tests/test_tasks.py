"""
Tests using FastAPI's TestClient.

TestClient lets us call the API in-process (no running server needed). Each
test gets a fresh in-memory store via dependency override, so tests are
isolated and fast.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_store
from app.storage import InMemoryTaskStore


@pytest.fixture()
def client():
    # Override the shared store with a brand-new one per test for isolation.
    store = InMemoryTaskStore()
    app.dependency_overrides[get_store] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_and_get_task(client):
    resp = client.post("/tasks", json={"title": "Learn FastAPI", "priority": "high"})
    assert resp.status_code == 201
    task = resp.json()
    assert task["title"] == "Learn FastAPI"
    assert task["priority"] == "high"
    assert task["completed"] is False
    assert "id" in task

    got = client.get(f"/tasks/{task['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == task["id"]


def test_list_tasks(client):
    client.post("/tasks", json={"title": "A"})
    client.post("/tasks", json={"title": "B"})
    resp = client.get("/tasks")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_update_task(client):
    created = client.post("/tasks", json={"title": "Draft"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"completed": True})
    assert resp.status_code == 200
    assert resp.json()["completed"] is True
    # untouched fields are preserved
    assert resp.json()["title"] == "Draft"


def test_delete_task(client):
    created = client.post("/tasks", json={"title": "Temp"}).json()
    resp = client.delete(f"/tasks/{created['id']}")
    assert resp.status_code == 204
    assert client.get(f"/tasks/{created['id']}").status_code == 404


def test_404_for_missing_task(client):
    assert client.get("/tasks/does-not-exist").status_code == 404
    assert client.patch("/tasks/nope", json={"title": "x"}).status_code == 404
    assert client.delete("/tasks/nope").status_code == 404


def test_validation_rejects_empty_title(client):
    # title has min_length=1, so an empty string must be rejected (422).
    resp = client.post("/tasks", json={"title": ""})
    assert resp.status_code == 422


def test_validation_rejects_bad_priority(client):
    resp = client.post("/tasks", json={"title": "X", "priority": "urgent"})
    assert resp.status_code == 422
