"""Tests for structured outputs + tool-calling loop (offline MockLLM)."""

from fastapi.testclient import TestClient

from app.main import app
from app.tools import build_default_registry


def test_health():
    with TestClient(app) as c:
        assert c.get("/health").json() == {"status": "ok"}


def test_extract_billing_negative():
    with TestClient(app) as c:
        r = c.post("/extract", json={"text": "I was charged twice and I'm angry, urgent refund!"})
        assert r.status_code == 200
        body = r.json()
        assert body["category"] == "billing"
        assert body["priority"] == "urgent"
        assert body["customer_sentiment"] == "negative"


def test_extract_returns_valid_schema():
    with TestClient(app) as c:
        r = c.post("/extract", json={"text": "My login is broken"})
        body = r.json()
        # category/priority must be within the enum -> proves schema enforcement
        assert body["category"] in {"billing", "technical", "account", "other"}
        assert body["priority"] in {"low", "medium", "high", "urgent"}


def test_agent_weather_tool():
    with TestClient(app) as c:
        r = c.post("/agent", json={"question": "what is the weather in paris?"})
        assert r.status_code == 200
        body = r.json()
        assert len(body["tool_calls"]) == 1
        assert body["tool_calls"][0]["tool"] == "get_weather"
        assert "rainy" in body["tool_calls"][0]["result"]


def test_agent_order_tool():
    with TestClient(app) as c:
        r = c.post("/agent", json={"question": "status of order A100"})
        body = r.json()
        assert body["tool_calls"][0]["tool"] == "search_orders"
        assert body["tool_calls"][0]["result"] == "shipped"


def test_agent_no_tool_needed():
    with TestClient(app) as c:
        r = c.post("/agent", json={"question": "tell me a joke"})
        body = r.json()
        assert body["tool_calls"] == []
        assert body["iterations"] == 1


def test_registry_rejects_unknown_tool():
    reg = build_default_registry()
    assert reg.execute("delete_everything", {}) == "error: unknown tool 'delete_everything'"


def test_registry_validates_arguments():
    reg = build_default_registry()
    # missing required 'city' -> validation firewall blocks execution
    out = reg.execute("get_weather", {})
    assert out.startswith("error: invalid arguments")


def test_calculate_is_injection_safe():
    reg = build_default_registry()
    # not a valid arithmetic expression -> safely rejected, never eval'd
    out = reg.execute("calculate", {"expression": "__import__('os')"})
    assert out == "could not evaluate expression"
    assert reg.execute("calculate", {"expression": "2 + 3"}) == "5"
