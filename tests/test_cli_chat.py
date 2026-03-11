"""Tests for the CLI chat module."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

from az_scout.services.cli_chat import (
    _render_choices,
    _render_choices_bar,
    _render_tool_call,
    _render_tool_result_panel,
    _render_welcome,
)


class TestRenderWelcome:
    """Tests for _render_welcome()."""

    def test_with_tenant_and_region(self) -> None:
        panel = _render_welcome("my-tenant", "francecentral")
        rendered = panel.renderable
        assert isinstance(rendered, str)
        assert "my-tenant" in rendered
        assert "francecentral" in rendered

    def test_without_context(self) -> None:
        panel = _render_welcome()
        rendered = panel.renderable
        assert isinstance(rendered, str)
        assert "not selected" in rendered

    def test_panel_title(self) -> None:
        panel = _render_welcome()
        assert panel.title is not None


class TestRenderChoices:
    """Tests for _render_choices()."""

    def test_extracts_choices(self) -> None:
        text = "Pick one:\n- [[Option A]]\n- [[Option B]]"
        cleaned, choices = _render_choices(text)
        assert choices == ["Option A", "Option B"]
        assert "[[" not in cleaned

    def test_no_choices(self) -> None:
        text = "No choices here."
        cleaned, choices = _render_choices(text)
        assert cleaned == text
        assert choices == []

    def test_single_choice(self) -> None:
        text = "Try this: [[Do something]]"
        cleaned, choices = _render_choices(text)
        assert choices == ["Do something"]
        assert "[[" not in cleaned

    def test_choices_bar_rendering(self) -> None:
        bar = _render_choices_bar(["Option A", "Option B"])
        plain = bar.plain
        assert "[1]" in plain
        assert "[2]" in plain
        assert "Option A" in plain
        assert "Option B" in plain


class TestRenderToolCall:
    """Tests for _render_tool_call()."""

    def test_basic_tool_call(self) -> None:
        panel = _render_tool_call("get_sku_availability", {"region": "eastus"})
        assert panel.title is not None
        assert "get_sku_availability" in str(panel.title)

    def test_empty_arguments(self) -> None:
        panel = _render_tool_call("list_tenants", {})
        assert panel.title is not None

    def test_list_argument(self) -> None:
        panel = _render_tool_call("get_zone_mappings", {"subscription_ids": ["a", "b"]})
        rendered = panel.renderable
        assert isinstance(rendered, str)
        assert "a, b" in rendered


class TestRenderToolResult:
    """Tests for _render_tool_result_panel()."""

    def test_list_result(self) -> None:
        import json

        content = json.dumps([{"sku": "Standard_D2s_v5"}, {"sku": "Standard_D4s_v5"}])
        panel = _render_tool_result_panel("get_sku_availability", content)
        assert panel.title is not None
        assert "get_sku_availability" in str(panel.title)

    def test_error_result(self) -> None:
        import json

        content = json.dumps({"error": "Not authorized"})
        panel = _render_tool_result_panel("list_tenants", content)
        rendered = panel.renderable
        assert isinstance(rendered, str)
        assert "Not authorized" in rendered

    def test_plain_text_result(self) -> None:
        panel = _render_tool_result_panel("some_tool", "plain text output")
        assert panel.title is not None


class TestSlashCommands:
    """Tests for slash command handling."""

    @staticmethod
    def _make_state(**overrides: Any) -> dict[str, Any]:
        state: dict[str, Any] = {
            "tenant_id": "tid",
            "subscription_id": "sid",
            "region": "eastus",
            "mode": "discussion",
            "messages": [],
            "choices": [],
        }
        state.update(overrides)
        return state

    def test_exit(self) -> None:
        import asyncio

        from az_scout.services.cli_chat import _handle_slash_command

        state = self._make_state()
        should_exit = asyncio.run(_handle_slash_command("/exit", state))
        assert should_exit is True

    def test_clear(self) -> None:
        import asyncio

        from az_scout.services.cli_chat import _handle_slash_command

        state = self._make_state(messages=[{"role": "user", "content": "hello"}])
        should_exit = asyncio.run(_handle_slash_command("/clear", state))
        assert should_exit is False
        assert state["messages"] == []

    def test_context(self) -> None:
        import asyncio

        from az_scout.services.cli_chat import _handle_slash_command

        state = self._make_state()
        should_exit = asyncio.run(_handle_slash_command("/context", state))
        assert should_exit is False
        assert state["tenant_id"] == "tid"
        assert state["subscription_id"] == "sid"
        assert state["region"] == "eastus"

    def test_help(self) -> None:
        import asyncio

        from az_scout.services.cli_chat import _handle_slash_command

        state = self._make_state()
        should_exit = asyncio.run(_handle_slash_command("/help", state))
        assert should_exit is False

    def test_unknown_command(self) -> None:
        import asyncio

        from az_scout.services.cli_chat import _handle_slash_command

        state = self._make_state()
        should_exit = asyncio.run(_handle_slash_command("/unknown", state))
        assert should_exit is False


class TestChatCliCommand:
    """Tests for the Click chat command."""

    def test_chat_help(self) -> None:
        from click.testing import CliRunner

        from az_scout.cli import cli

        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "--help"])
        assert result.exit_code == 0
        assert "Interactive AI chat" in result.output

    def test_chat_without_openai_config(self) -> None:
        from click.testing import CliRunner

        from az_scout.cli import cli

        runner = CliRunner()
        with patch.dict(
            "os.environ",
            {
                "AZURE_OPENAI_ENDPOINT": "",
                "AZURE_OPENAI_API_KEY": "",
                "AZURE_OPENAI_DEPLOYMENT": "",
            },
        ):
            result = runner.invoke(cli, ["chat"])
            assert "not configured" in result.output or result.exit_code == 0
