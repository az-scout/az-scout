"""FastAPI dependency and context for user authentication.

Provides two mechanisms:

1. **Explicit**: ``get_user_token(request)`` / ``is_direct_arm(request)``
   — used by discovery routes that pass tokens explicitly.

2. **Implicit (request context)**: ``set_request_auth()`` / ``get_request_auth()``
   — set automatically by ``AuthContextMiddleware`` so that deeply-nested
   ``_get_headers()`` calls can read the user token without every
   intermediate function signature needing ``user_token`` / ``direct_arm``
   parameters.

Uses both a module-level global (for sync-blocking plugin code on worker
threads spawned by ThreadPoolExecutor) and a contextvars.ContextVar (for
``asyncio.to_thread`` which copies context to worker threads).
"""

from __future__ import annotations

import contextvars

from fastapi import Request

# ContextVar — copied by asyncio.to_thread into worker threads.
_user_token_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_user_token_var", default=None
)
_direct_arm_var: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "_direct_arm_var", default=False
)

# Module-level fallback for code running on raw ThreadPoolExecutor threads
# (e.g. plugins that spawn their own thread pools).
_global_user_token: str | None = None
_global_direct_arm: bool = False
# Set to True by the middleware — allows _get_headers to distinguish
# "web request without token" (should block) from "CLI mode" (should allow).
_in_web_request: bool = False


def set_request_auth(
    user_token: str | None, direct_arm: bool
) -> tuple[contextvars.Token[str | None], contextvars.Token[bool]]:
    """Store auth info for the current request. Returns tokens for cleanup."""
    global _global_user_token, _global_direct_arm, _in_web_request  # noqa: PLW0603
    _global_user_token = user_token
    _global_direct_arm = direct_arm
    _in_web_request = True
    tok = _user_token_var.set(user_token)
    drm = _direct_arm_var.set(direct_arm)
    return tok, drm


def clear_request_auth(
    tokens: tuple[contextvars.Token[str | None], contextvars.Token[bool]],
) -> None:
    """Remove auth info after request completes."""
    global _global_user_token, _global_direct_arm, _in_web_request  # noqa: PLW0603
    _global_user_token = None
    _global_direct_arm = False
    _in_web_request = False
    _user_token_var.reset(tokens[0])
    _direct_arm_var.reset(tokens[1])


def get_request_auth() -> tuple[str | None, bool]:
    """Read auth info for the current request.

    Tries the context var first (works with asyncio.to_thread).
    Falls back to the module global (works with raw ThreadPoolExecutor).
    """
    token = _user_token_var.get()
    if token is not None:
        return token, _direct_arm_var.get()
    # Fallback: module global (for raw thread pool workers)
    return _global_user_token, _global_direct_arm


def get_user_token(request: Request) -> str | None:
    """Extract Bearer token from the Authorization header, or None."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def is_direct_arm(request: Request) -> bool:
    """Return True if the request carries a direct ARM token (MFA fallback)."""
    return request.headers.get("X-Direct-ARM") == "true"
