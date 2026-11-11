"""Configuration and authentication for Azure OpenAI integration.

Two authentication modes are supported:

* **API key** – ``AZURE_OPENAI_API_KEY`` is sent in the ``api-key`` header.
* **Microsoft Entra ID (keyless)** – a bearer token for the Cognitive Services
  scope is acquired with the app's ``DefaultAzureCredential`` (managed identity
  on Azure Container Apps, ``az login`` locally).

``AZURE_OPENAI_AUTH_MODE`` selects the mode: ``auto`` (default – key when set,
Entra ID otherwise), ``key`` or ``entra``.

AI chat calls always use the **app** identity, never the signed-in user's OBO
token, so they deliberately bypass ``azure_api._auth._get_headers()``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "")
AZURE_OPENAI_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21")
AZURE_OPENAI_AUTH_MODE = os.environ.get("AZURE_OPENAI_AUTH_MODE", "auto")

COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"

_VALID_AUTH_MODES = ("auto", "key", "entra")

# Entra token cache: scope → (token_str, expires_on_epoch)
_openai_token_cache: dict[str, tuple[str, float]] = {}
_openai_token_lock = threading.Lock()
_TOKEN_REFRESH_MARGIN = 120  # refresh 2 min before expiry


class AzureOpenAIAuthError(RuntimeError):
    """Raised when az-scout cannot authenticate to Azure OpenAI."""


def get_auth_mode() -> str:
    """Return the effective Azure OpenAI auth mode: ``"key"`` or ``"entra"``."""
    mode = (AZURE_OPENAI_AUTH_MODE or "auto").strip().lower()
    if mode not in _VALID_AUTH_MODES:
        logger.warning("Invalid AZURE_OPENAI_AUTH_MODE=%r, falling back to 'auto'", mode)
        mode = "auto"
    if mode == "auto":
        return "key" if AZURE_OPENAI_API_KEY else "entra"
    return mode


def is_chat_enabled() -> bool:
    """Return True if Azure OpenAI is configured.

    ``AZURE_OPENAI_ENDPOINT`` and ``AZURE_OPENAI_DEPLOYMENT`` are required.
    ``AZURE_OPENAI_API_KEY`` is optional (Entra ID auth is used without it),
    unless ``AZURE_OPENAI_AUTH_MODE=key`` is set explicitly.
    """
    if not (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT):
        return False
    return not (get_auth_mode() == "key" and not AZURE_OPENAI_API_KEY)


def _get_entra_token() -> str:
    """Return a cached Entra ID token for Azure OpenAI (blocking)."""
    # Imported lazily via the module so test patches of ``_auth.credential`` apply.
    from az_scout.azure_api import _auth

    with _openai_token_lock:
        cached = _openai_token_cache.get(COGNITIVE_SERVICES_SCOPE)
        if cached is not None:
            token_str, expires_on = cached
            if time.time() < expires_on - _TOKEN_REFRESH_MARGIN:
                return token_str

        logger.debug("Acquiring Azure OpenAI token (scope=%s)", COGNITIVE_SERVICES_SCOPE)
        try:
            token = _auth.credential.get_token(COGNITIVE_SERVICES_SCOPE)
        except Exception as exc:
            raise AzureOpenAIAuthError(
                "Could not acquire a Microsoft Entra ID token for Azure OpenAI "
                f"({type(exc).__name__}). Sign in with `az login` locally, or check "
                "the managed identity (AZURE_CLIENT_ID) on Azure. Alternatively set "
                "AZURE_OPENAI_API_KEY."
            ) from exc
        token_str = str(token.token)
        _openai_token_cache[COGNITIVE_SERVICES_SCOPE] = (token_str, float(token.expires_on))
        logger.debug("Azure OpenAI token acquired (expires_on=%d)", token.expires_on)
        return token_str


def clear_token_cache() -> None:
    """Drop the cached Azure OpenAI Entra token (used by tests)."""
    with _openai_token_lock:
        _openai_token_cache.clear()


async def get_openai_auth_headers() -> dict[str, str]:
    """Return request headers (incl. auth) for an Azure OpenAI call.

    Call this per request so long sessions pick up refreshed tokens.
    """
    headers = {"Content-Type": "application/json"}
    if get_auth_mode() == "key":
        headers["api-key"] = AZURE_OPENAI_API_KEY
    else:
        token = await asyncio.to_thread(_get_entra_token)
        headers["Authorization"] = f"Bearer {token}"
    return headers


def describe_auth_failure(status_code: int, body: str = "") -> str | None:
    """Return an actionable message for a 401/403 from Azure OpenAI, else None."""
    if status_code not in (401, 403):
        return None
    if get_auth_mode() == "key":
        msg = (
            f"Azure OpenAI rejected the API key (HTTP {status_code}). Check "
            "AZURE_OPENAI_API_KEY, or unset it to use Microsoft Entra ID auth "
            "(required when the resource has local auth disabled)."
        )
    else:
        msg = (
            f"Azure OpenAI rejected the Microsoft Entra ID token (HTTP {status_code}). "
            "Make sure the app identity has the 'Cognitive Services OpenAI User' role "
            "(or 'Azure AI User' for Foundry) on the AI resource, and that "
            "AZURE_CLIENT_ID points to the right managed identity."
        )
    if body:
        msg += f" Details: {body}"
    return msg
