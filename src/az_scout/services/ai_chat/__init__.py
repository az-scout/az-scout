"""AI Chat service – Azure OpenAI with tool-calling over az-scout functions.

Provides a streaming chat endpoint that uses Azure OpenAI to answer questions
about Azure infrastructure, calling az-scout tool functions when needed.

Requires environment variables:
    AZURE_OPENAI_ENDPOINT    – e.g. https://my-resource.openai.azure.com
    AZURE_OPENAI_DEPLOYMENT  – deployment name (e.g. gpt-4o)

Optional:
    AZURE_OPENAI_API_KEY     – API key; when unset, Microsoft Entra ID (keyless)
                               auth is used via DefaultAzureCredential
    AZURE_OPENAI_AUTH_MODE   – ``auto`` (default), ``key`` or ``entra``
"""

from __future__ import annotations

from az_scout.services.ai_chat._complete import CompletionResult as CompletionResult
from az_scout.services.ai_chat._complete import ai_complete as ai_complete
from az_scout.services.ai_chat._config import (
    AZURE_OPENAI_API_KEY as AZURE_OPENAI_API_KEY,
)
from az_scout.services.ai_chat._config import (
    AZURE_OPENAI_API_VERSION as AZURE_OPENAI_API_VERSION,
)
from az_scout.services.ai_chat._config import (
    AZURE_OPENAI_DEPLOYMENT as AZURE_OPENAI_DEPLOYMENT,
)
from az_scout.services.ai_chat._config import (
    AZURE_OPENAI_ENDPOINT as AZURE_OPENAI_ENDPOINT,
)
from az_scout.services.ai_chat._config import (
    AzureOpenAIAuthError as AzureOpenAIAuthError,
)
from az_scout.services.ai_chat._config import (
    get_openai_auth_headers as get_openai_auth_headers,
)
from az_scout.services.ai_chat._config import (
    is_chat_enabled as is_chat_enabled,
)
from az_scout.services.ai_chat._dispatch import (
    _post_process_tool_result as _post_process_tool_result,
)
from az_scout.services.ai_chat._dispatch import (
    _truncate_tool_result as _truncate_tool_result,
)
from az_scout.services.ai_chat._prompts import (
    SYSTEM_PROMPT as SYSTEM_PROMPT,
)
from az_scout.services.ai_chat._prompts import (
    _build_system_prompt as _build_system_prompt,
)
from az_scout.services.ai_chat._stream import chat_stream as chat_stream
from az_scout.services.ai_chat._tools import (
    TOOL_DEFINITIONS as TOOL_DEFINITIONS,
)
from az_scout.services.ai_chat._tools import (
    _build_openai_tools as _build_openai_tools,
)
from az_scout.services.ai_chat._tools import (
    _mcp_schema_to_openai as _mcp_schema_to_openai,
)
from az_scout.services.ai_chat._tools import (
    refresh_tool_definitions as refresh_tool_definitions,
)
