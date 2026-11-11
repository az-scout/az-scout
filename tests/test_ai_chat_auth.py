"""Tests for Azure OpenAI authentication (API key vs Microsoft Entra ID)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from az_scout.services.ai_chat._complete import ai_complete
from az_scout.services.ai_chat._config import (
    COGNITIVE_SERVICES_SCOPE,
    AzureOpenAIAuthError,
    get_auth_mode,
    get_openai_auth_headers,
    is_chat_enabled,
)
from az_scout.services.ai_chat._stream import chat_stream

_CFG = "az_scout.services.ai_chat._config"


@pytest.fixture()
def _configured() -> Iterator[None]:
    """Endpoint + deployment configured, no API key, auto mode."""
    with (
        patch(f"{_CFG}.AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com"),
        patch(f"{_CFG}.AZURE_OPENAI_DEPLOYMENT", "gpt-test"),
        patch(f"{_CFG}.AZURE_OPENAI_API_KEY", ""),
        patch(f"{_CFG}.AZURE_OPENAI_AUTH_MODE", "auto"),
    ):
        yield


def _patch_httpx(handler: Callable[[httpx.Request], httpx.Response]) -> Any:
    """Route every ``httpx.AsyncClient`` through a MockTransport."""
    real_client = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    return patch("httpx.AsyncClient", side_effect=factory)


def _completion(content: str = "hello") -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]},
    )


# ---------------------------------------------------------------------------
# is_chat_enabled / auth mode
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("_configured")
class TestIsChatEnabled:
    def test_enabled_without_api_key(self) -> None:
        assert is_chat_enabled() is True
        assert get_auth_mode() == "entra"

    def test_enabled_with_api_key(self) -> None:
        with patch(f"{_CFG}.AZURE_OPENAI_API_KEY", "secret"):
            assert is_chat_enabled() is True
            assert get_auth_mode() == "key"

    def test_disabled_without_deployment(self) -> None:
        with patch(f"{_CFG}.AZURE_OPENAI_DEPLOYMENT", ""):
            assert is_chat_enabled() is False

    def test_explicit_key_mode_requires_key(self) -> None:
        with patch(f"{_CFG}.AZURE_OPENAI_AUTH_MODE", "key"):
            assert is_chat_enabled() is False

    def test_explicit_entra_mode_ignores_key(self) -> None:
        with (
            patch(f"{_CFG}.AZURE_OPENAI_AUTH_MODE", "ENTRA"),
            patch(f"{_CFG}.AZURE_OPENAI_API_KEY", "secret"),
        ):
            assert get_auth_mode() == "entra"

    def test_invalid_mode_falls_back_to_auto(self) -> None:
        with patch(f"{_CFG}.AZURE_OPENAI_AUTH_MODE", "bogus"):
            assert get_auth_mode() == "entra"


# ---------------------------------------------------------------------------
# get_openai_auth_headers
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("_configured")
class TestAuthHeaders:
    def test_api_key_header_without_token_call(self, _mock_credential: MagicMock) -> None:
        with patch(f"{_CFG}.AZURE_OPENAI_API_KEY", "secret"):
            headers = asyncio.run(get_openai_auth_headers())
        assert headers["api-key"] == "secret"
        assert "Authorization" not in headers
        _mock_credential.get_token.assert_not_called()

    def test_bearer_header_with_cognitive_scope(self, _mock_credential: MagicMock) -> None:
        headers = asyncio.run(get_openai_auth_headers())
        assert headers["Authorization"] == "Bearer fake-token"
        assert "api-key" not in headers
        _mock_credential.get_token.assert_called_once_with(COGNITIVE_SERVICES_SCOPE)

    def test_token_is_cached(self, _mock_credential: MagicMock) -> None:
        asyncio.run(get_openai_auth_headers())
        asyncio.run(get_openai_auth_headers())
        assert _mock_credential.get_token.call_count == 1

    def test_token_refreshed_near_expiry(self, _mock_credential: MagicMock) -> None:
        soon = MagicMock(token="old-token", expires_on=time.time() + 30)
        fresh = MagicMock(token="new-token", expires_on=time.time() + 3600)
        _mock_credential.get_token.side_effect = [soon, fresh]

        first = asyncio.run(get_openai_auth_headers())
        second = asyncio.run(get_openai_auth_headers())

        assert first["Authorization"] == "Bearer old-token"
        assert second["Authorization"] == "Bearer new-token"
        assert _mock_credential.get_token.call_count == 2

    def test_credential_failure_raises_actionable_error(self, _mock_credential: MagicMock) -> None:
        _mock_credential.get_token.side_effect = RuntimeError("no identity")
        with pytest.raises(AzureOpenAIAuthError, match="az login"):
            asyncio.run(get_openai_auth_headers())

    def test_uses_app_identity_when_obo_enabled(self, _mock_credential: MagicMock) -> None:
        """AI chat must not go through the OBO exchange / _NO_TOKEN guard."""
        from az_scout.auth import clear_request_auth, set_request_auth

        ctx = set_request_auth(None)  # web request without user token → _NO_TOKEN
        try:
            with (
                patch("az_scout.azure_api._obo.is_obo_enabled", return_value=True),
                patch("az_scout.azure_api._obo.obo_exchange") as obo_exchange,
            ):
                headers = asyncio.run(get_openai_auth_headers())
        finally:
            clear_request_auth(ctx)

        assert headers["Authorization"] == "Bearer fake-token"
        obo_exchange.assert_not_called()
        _mock_credential.get_token.assert_called_once_with(COGNITIVE_SERVICES_SCOPE)


# ---------------------------------------------------------------------------
# Request paths (ai_complete / chat_stream)
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("_configured")
class TestRequestAuth:
    def test_complete_sends_bearer(self) -> None:
        seen: list[httpx.Request] = []

        def handler(req: httpx.Request) -> httpx.Response:
            seen.append(req)
            return _completion("hi")

        with _patch_httpx(handler):
            result = asyncio.run(ai_complete("hello", tools=False, cache_ttl=0))

        assert result.content == "hi"
        assert seen[0].headers["Authorization"] == "Bearer fake-token"
        assert "api-key" not in seen[0].headers
        assert "example.openai.azure.com/openai/deployments/gpt-test" in str(seen[0].url)

    def test_complete_sends_api_key(self, _mock_credential: MagicMock) -> None:
        seen: list[httpx.Request] = []

        def handler(req: httpx.Request) -> httpx.Response:
            seen.append(req)
            return _completion()

        with patch(f"{_CFG}.AZURE_OPENAI_API_KEY", "secret"), _patch_httpx(handler):
            asyncio.run(ai_complete("hello", tools=False, cache_ttl=0))

        assert seen[0].headers["api-key"] == "secret"
        assert "Authorization" not in seen[0].headers
        _mock_credential.get_token.assert_not_called()

    def test_complete_403_raises_role_hint(self) -> None:
        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(403, json={"error": {"code": "PermissionDenied"}})

        with _patch_httpx(handler), pytest.raises(AzureOpenAIAuthError) as exc_info:
            asyncio.run(ai_complete("hello", tools=False, cache_ttl=0))
        assert "Cognitive Services OpenAI User" in str(exc_info.value)
        assert "AZURE_CLIENT_ID" in str(exc_info.value)

    def test_complete_endpoint_returns_502_on_auth_error(self, client: Any) -> None:
        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(401, text="unauthorized")

        with _patch_httpx(handler):
            resp = client.post("/api/ai/complete", json={"prompt": "hi", "cache_ttl": 0})
        assert resp.status_code == 502
        assert "Cognitive Services OpenAI User" in resp.json()["error"]

    def test_headers_rebuilt_per_request(self, _mock_credential: MagicMock) -> None:
        """Each tool round fetches headers again so expiring tokens refresh."""
        tokens = iter(
            [
                MagicMock(token="t1", expires_on=time.time() + 10),  # inside refresh margin
                MagicMock(token="t2", expires_on=time.time() + 3600),
            ]
        )
        _mock_credential.get_token.side_effect = lambda *_a, **_k: next(tokens)
        seen: list[str] = []
        responses = iter(
            [
                httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "finish_reason": "tool_calls",
                                "message": {
                                    "role": "assistant",
                                    "tool_calls": [
                                        {
                                            "id": "c1",
                                            "type": "function",
                                            "function": {"name": "noop", "arguments": "{}"},
                                        }
                                    ],
                                },
                            }
                        ]
                    },
                ),
                _completion("done"),
            ]
        )

        def handler(req: httpx.Request) -> httpx.Response:
            seen.append(req.headers["Authorization"])
            return next(responses)

        with (
            _patch_httpx(handler),
            patch("az_scout.services.ai_chat._complete._execute_tool", return_value="{}"),
        ):
            result = asyncio.run(ai_complete("hello", cache_ttl=0))

        assert result.content == "done"
        assert seen == ["Bearer t1", "Bearer t2"]

    def _collect_stream(self) -> list[dict[str, Any]]:
        async def run() -> list[str]:
            return [line async for line in chat_stream([{"role": "user", "content": "hi"}])]

        events = asyncio.run(run())
        return [json.loads(e.removeprefix("data: ").strip()) for e in events]

    def test_stream_sends_bearer(self) -> None:
        seen: list[httpx.Request] = []
        body = (
            'data: {"choices":[{"delta":{"content":"yo"},"finish_reason":"stop"}]}\n\n'
            "data: [DONE]\n\n"
        )

        def handler(req: httpx.Request) -> httpx.Response:
            seen.append(req)
            return httpx.Response(200, text=body)

        with _patch_httpx(handler):
            events = self._collect_stream()

        assert seen[0].headers["Authorization"] == "Bearer fake-token"
        assert {"type": "delta", "content": "yo"} in events

    def test_stream_401_surfaces_role_hint(self) -> None:
        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(401, text="unauthorized")

        with _patch_httpx(handler):
            events = self._collect_stream()

        errors = [e for e in events if e["type"] == "error"]
        assert errors and "Cognitive Services OpenAI User" in errors[0]["content"]
        assert events[-1] == {"type": "done"}

    def test_stream_token_failure_surfaces_error(self, _mock_credential: MagicMock) -> None:
        _mock_credential.get_token.side_effect = RuntimeError("boom")

        def handler(req: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("should not be called")

        with _patch_httpx(handler):
            events = self._collect_stream()

        errors = [e for e in events if e["type"] == "error"]
        assert errors and "Entra ID token" in errors[0]["content"]
        assert events[-1] == {"type": "done"}
