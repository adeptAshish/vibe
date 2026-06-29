"""Tests: non-streaming + SSE streaming, both on MockLLM (offline)."""

from fastapi.testclient import TestClient

from app.main import app


def test_health():
    with TestClient(app) as c:
        assert c.get("/health").json() == {"status": "ok"}


def test_chat_complete():
    with TestClient(app) as c:
        r = c.post("/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        assert r.status_code == 200
        body = r.json()
        assert "hi" in body["content"]
        assert body["usage"]["total_tokens"] > 0


def test_chat_stream_sse():
    with TestClient(app) as c:
        with c.stream("POST", "/chat/stream", json={"messages": [{"role": "user", "content": "hello"}]}) as r:
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            text = "".join(r.iter_text())
            assert "data:" in text
            assert "[DONE]" in text


def test_validation():
    with TestClient(app) as c:
        assert c.post("/chat", json={"messages": []}).status_code == 422
