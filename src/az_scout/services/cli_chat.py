"""Interactive CLI chat for az-scout.

Renders AI chat streaming events in the terminal using Rich for styled output
and prompt_toolkit for interactive input.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any

from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.document import Document
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.history import InMemoryHistory
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

from az_scout.services.ai_chat._config import is_chat_enabled
from az_scout.services.ai_chat._stream import chat_stream

# Regex to find [[choice text]] patterns in assistant responses
_CHOICE_RE = re.compile(r"\[\[(.+?)\]\]")

# Slash commands
_SLASH_COMMANDS = {
    "/exit": "Exit the chat session",
    "/new": "Start a new session (re-select tenant, clear history)",
    "/clear": "Clear conversation history",
    "/mode": "Switch chat mode (discussion, planner, …)",
    "/help": "Show available commands",
    "/context": "Show current tenant, region, subscription, and mode",
    "/tenant": "Switch tenant (interactive picker)",
    "/region": "Switch region (interactive picker)",
    "/subscription": "Switch subscription (interactive picker)",
    "/tenants": "List accessible tenants",
    "/subscriptions": "List enabled subscriptions",
    "/regions": "List AZ-enabled regions",
}

console = Console()


class _SlashCompleter(Completer):
    """Auto-complete slash commands and their arguments."""

    def get_completions(self, document: Document, complete_event: object) -> Iterable[Completion]:
        text = document.text_before_cursor
        if not text.startswith("/"):
            return

        parts = text.split(maxsplit=1)
        cmd = parts[0]

        # If still typing the command name (no space yet), complete commands
        if len(parts) == 1 and not text.endswith(" "):
            for name, desc in _SLASH_COMMANDS.items():
                if name.startswith(cmd):
                    yield Completion(
                        name,
                        start_position=-len(text),
                        display=name,
                        display_meta=desc,
                    )
            return

        # Command is complete — suggest arguments
        arg_prefix = parts[1] if len(parts) > 1 else ""
        yield from self._complete_args(cmd, arg_prefix)

    def _complete_args(self, cmd: str, prefix: str) -> Iterable[Completion]:
        """Yield argument completions for a given command."""
        if cmd == "/mode":
            yield from self._complete_mode(prefix)
        elif cmd == "/region":
            yield from self._complete_region(prefix)
        elif cmd == "/tenant":
            yield from self._complete_tenant(prefix)
        elif cmd == "/subscription":
            yield from self._complete_subscription(prefix)

    @staticmethod
    def _complete_mode(prefix: str) -> Iterable[Completion]:
        modes = {"discussion": "General assistant", "planner": "Deployment planner"}
        try:
            from az_scout.plugins import get_plugin_chat_modes

            for mode_id, cm in get_plugin_chat_modes().items():
                modes[mode_id] = cm.label
        except Exception:
            pass
        for mode_id, label in modes.items():
            if mode_id.startswith(prefix):
                yield Completion(
                    mode_id,
                    start_position=-len(prefix),
                    display=mode_id,
                    display_meta=label,
                )

    @staticmethod
    def _complete_region(prefix: str) -> Iterable[Completion]:
        try:
            from az_scout.azure_api.discovery import list_regions

            regions = list_regions()
            for r in regions:
                name = r.get("name", "")
                display_name = r.get("displayName", "")
                if name.startswith(prefix):
                    yield Completion(
                        name,
                        start_position=-len(prefix),
                        display=name,
                        display_meta=display_name,
                    )
        except Exception:
            pass

    @staticmethod
    def _complete_tenant(prefix: str) -> Iterable[Completion]:
        try:
            from az_scout.azure_api.discovery import list_tenants

            result = list_tenants()
            for t in result.get("tenants", []):
                tid = t.get("id", "")
                name = t.get("name", "")
                if name.lower().startswith(prefix) or tid.startswith(prefix):
                    yield Completion(
                        tid,
                        start_position=-len(prefix),
                        display=name,
                        display_meta=tid[:13] + "…",
                    )
        except Exception:
            pass

    @staticmethod
    def _complete_subscription(prefix: str) -> Iterable[Completion]:
        try:
            from az_scout.azure_api.discovery import list_subscriptions

            subs = list_subscriptions()
            for s in subs:
                sid = s.get("id", "")
                name = s.get("name", "")
                if name.lower().startswith(prefix) or sid.startswith(prefix):
                    yield Completion(
                        sid,
                        start_position=-len(prefix),
                        display=name,
                        display_meta=sid[:13] + "…",
                    )
        except Exception:
            pass


_cli_tools_registered = False


def _register_cli_tools() -> None:
    """Register internal + external plugin MCP tools for CLI chat.

    The web app does this in its lifespan via ``register_plugins()``, but the
    CLI chat has no FastAPI app.  We only need to register MCP tools (not
    routes or static assets), then refresh the OpenAI tool definitions.
    """
    global _cli_tools_registered  # noqa: PLW0603
    if _cli_tools_registered:
        return
    _cli_tools_registered = True

    import logging

    from az_scout.internal_plugins import discover_internal_plugins
    from az_scout.mcp_server import mcp as mcp_server
    from az_scout.plugins import discover_plugins
    from az_scout.services.ai_chat._tools import refresh_tool_definitions

    logger = logging.getLogger(__name__)

    # Collect names of already-registered tools to avoid duplicates
    existing = {t.name for t in mcp_server._tool_manager.list_tools()}

    for plugin in [*discover_internal_plugins(), *discover_plugins()]:
        try:
            tools = plugin.get_mcp_tools()
            if tools:
                added = 0
                for fn in tools:
                    if fn.__name__ not in existing:
                        mcp_server.tool()(fn)
                        existing.add(fn.__name__)
                        added += 1
                if added:
                    logger.debug("CLI: registered %d tool(s) from '%s'", added, plugin.name)
        except Exception:
            logger.exception("CLI: failed to register tools from '%s'", plugin.name)

    refresh_tool_definitions()
    logger.debug("CLI: tool definitions refreshed")


def _render_welcome(
    tenant_name: str | None = None,
    region: str | None = None,
    subscription_name: str | None = None,
) -> Panel:
    """Build the welcome panel."""
    lines = [
        "[bold]🔭 Azure Scout Assistant[/bold]",
        "",
    ]
    if tenant_name:
        lines.append(f"  Tenant:       [cyan]{tenant_name}[/cyan]")
    else:
        lines.append("  Tenant:       [dim]not selected[/dim]")

    if subscription_name:
        lines.append(f"  Subscription: [cyan]{subscription_name}[/cyan]")
    else:
        lines.append("  Subscription: [dim]not selected — I'll ask when needed[/dim]")

    if region:
        lines.append(f"  Region:       [cyan]{region}[/cyan]")
    else:
        lines.append("  Region:       [dim]not selected — I'll ask when needed[/dim]")

    lines += [
        "",
        "  [dim]Type your question, or try:[/dim]",
        '  • [italic]"What SKUs are available in swedencentral?"[/italic]',
        '  • [italic]"Compare zones for Standard_D4s_v5 across subscriptions"[/italic]',
        '  • [italic]"Show spot scores for GPU SKUs in eastus"[/italic]',
        "",
        "  [dim]Type /help for commands, Ctrl+D to exit.[/dim]",
    ]
    return Panel(
        "\n".join(lines),
        border_style="bright_blue",
        title="[bold bright_blue]az-scout[/bold bright_blue]",
        padding=(1, 2),
    )


def _render_tool_call(name: str, arguments: dict[str, Any]) -> Panel:
    """Render a tool call notification panel."""
    args_parts: list[str] = []
    for k, v in arguments.items():
        if isinstance(v, list):
            v = ", ".join(str(i) for i in v)
        args_parts.append(f"[dim]{k}:[/dim] {v}")
    body = "  " + "\n  ".join(args_parts) if args_parts else ""
    return Panel(
        body,
        title=f"[bold yellow]🔧 {name}[/bold yellow]",
        border_style="yellow",
        padding=(0, 1),
    )


def _render_tool_result_panel(name: str, content: str) -> Panel:
    """Render a collapsed tool result panel."""
    # Try to show as a compact summary
    try:
        data = json.loads(content)
        if isinstance(data, list):
            summary = f"[dim]Returned {len(data)} items[/dim]"
        elif isinstance(data, dict) and "error" in data:
            summary = f"[red]Error: {data['error']}[/red]"
        elif isinstance(data, dict):
            summary = f"[dim]Returned {len(data)} fields[/dim]"
        else:
            summary = f"[dim]{str(data)[:100]}[/dim]"
    except (json.JSONDecodeError, ValueError):
        summary = f"[dim]{content[:100]}{'…' if len(content) > 100 else ''}[/dim]"

    return Panel(
        summary,
        title=f"[bold green]✓ {name}[/bold green]",
        border_style="green",
        padding=(0, 1),
    )


def _render_choices(text: str) -> tuple[str, list[str]]:
    """Extract [[choice]] patterns and replace with numbered options.

    Returns the cleaned text and a list of choice strings.
    """
    choices: list[str] = _CHOICE_RE.findall(text)
    if not choices:
        return text, []

    # Remove the [[...]] markers from the text
    cleaned = _CHOICE_RE.sub("", text)
    # Remove any trailing blank bullet lines left behind
    cleaned = re.sub(r"\n\s*[-•]\s*\n", "\n", cleaned)
    cleaned = cleaned.rstrip()

    return cleaned, choices


def _render_choices_bar(choices: list[str]) -> Text:
    """Render choices as a numbered bar."""
    t = Text()
    for i, choice in enumerate(choices, 1):
        t.append(f"  [{i}] ", style="bold cyan")
        t.append(choice, style="cyan")
    return t


async def _stream_response(
    messages: list[dict[str, Any]],
    *,
    tenant_id: str | None = None,
    region: str | None = None,
    subscription_id: str | None = None,
    mode: str = "discussion",
) -> tuple[str, list[str]]:
    """Consume the chat_stream and render events to the terminal.

    Returns (full_assistant_text, choices_list).
    """
    content_parts: list[str] = []
    spinner_live: Live | None = None

    try:
        async for sse_line in chat_stream(
            messages,
            tenant_id=tenant_id,
            region=region,
            subscription_id=subscription_id,
            mode=mode,
        ):
            # Parse SSE line
            if not sse_line.startswith("data: "):
                continue
            try:
                event = json.loads(sse_line[6:])
            except json.JSONDecodeError:
                continue

            event_type = event.get("type")

            if event_type == "delta":
                # Accumulate streamed text
                chunk = event.get("content", "")
                content_parts.append(chunk)

            elif event_type == "tool_call":
                # Show tool call panel
                name = event.get("name", "unknown")
                try:
                    args = json.loads(event.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}
                console.print(_render_tool_call(name, args))

                # Show spinner while tool executes
                spinner_live = Live(
                    Spinner("dots", text=f"  Running {name}…", style="yellow"),
                    console=console,
                    transient=True,
                )
                spinner_live.start()

            elif event_type == "tool_result":
                # Stop spinner, show result summary
                if spinner_live:
                    spinner_live.stop()
                    spinner_live = None
                name = event.get("name", "unknown")
                content = event.get("content", "")
                console.print(_render_tool_result_panel(name, content))

            elif event_type == "status":
                msg = event.get("content", "")
                console.print(f"  [dim italic]{msg}[/dim italic]")

            elif event_type == "error":
                if spinner_live:
                    spinner_live.stop()
                    spinner_live = None
                msg = event.get("content", "")
                console.print(Panel(msg, title="[bold red]Error[/bold red]", border_style="red"))

            elif event_type == "done":
                break

    finally:
        if spinner_live:
            spinner_live.stop()

    # Render the full response as markdown
    full_text = "".join(content_parts)
    if full_text.strip():
        cleaned, choices = _render_choices(full_text)
        console.print()
        console.print(Markdown(cleaned))
        if choices:
            console.print()
            console.print(_render_choices_bar(choices))
        console.print()
        return full_text, choices

    return full_text, []


async def _pick_from_list(
    items: list[dict[str, str]],
    label_key: str,
    id_key: str,
    title: str,
) -> str | None:
    """Interactive picker for tenants/subscriptions/regions."""
    if not items:
        console.print(f"  [dim]No {title} available.[/dim]")
        return None

    table = Table(title=title, border_style="bright_blue", show_lines=False)
    table.add_column("#", style="bold cyan", width=4)
    table.add_column("Name", style="white")
    table.add_column("ID", style="dim")

    for i, item in enumerate(items, 1):
        table.add_row(str(i), item[label_key], item.get(id_key, ""))

    console.print(table)

    session: PromptSession[str] = PromptSession()
    try:
        answer = await session.prompt_async(
            HTML("<b>  Select #: </b>"),
        )
        idx = int(answer.strip()) - 1
        if 0 <= idx < len(items):
            return items[idx][id_key]
        console.print("  [red]Invalid selection.[/red]")
    except (ValueError, KeyboardInterrupt, EOFError):
        pass
    return None


async def _resolve_context() -> tuple[str | None, str | None, str | None]:
    """Resolve initial tenant context only.

    Subscription and region are deferred — the AI will ask when needed.
    """
    from az_scout.azure_api.discovery import list_tenants

    # Tenant — auto-select if only one authenticated
    tenant_id: str | None = None
    try:
        result = list_tenants()
        tenants: list[dict[str, Any]] = result.get("tenants", [])
        authed = [t for t in tenants if t.get("authenticated")]
        if len(authed) == 1:
            tenant_id = authed[0]["id"]
            console.print(f"  [dim]Auto-selected tenant:[/dim] [cyan]{authed[0]['name']}[/cyan]")
        elif authed:
            console.print()
            items = [{"name": t["name"], "id": t["id"]} for t in authed]
            tenant_id = await _pick_from_list(items, "name", "id", "Select Tenant")
    except Exception as exc:
        console.print(f"  [yellow]Could not list tenants: {exc}[/yellow]")

    # Subscription and region are left unset — the AI will use
    # list_subscriptions / list_regions tools when the conversation needs them.
    return tenant_id, None, None


async def _handle_slash_command(
    command: str,
    state: dict[str, Any],
) -> bool:
    """Handle a slash command, mutating *state* in place.

    Returns True if the session should exit.
    """
    parts = command.strip().lower().split(maxsplit=1)
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else None

    if cmd == "/exit":
        return True

    if cmd == "/new":
        state["messages"].clear()
        state["choices"] = []
        console.print("  [dim]Session reset — re-selecting context…[/dim]")
        tid, _, _ = await _resolve_context()
        state["tenant_id"] = tid
        state["subscription_id"] = None
        state["region"] = None
        state["mode"] = "discussion"
        console.print("  [green]New session ready.[/green]")
        return False

    if cmd == "/clear":
        state["messages"].clear()
        state["choices"] = []
        console.print("  [dim]Conversation cleared.[/dim]")
        return False

    if cmd == "/mode":
        from az_scout.plugins import get_plugin_chat_modes

        modes = {"discussion": "General assistant", "planner": "Deployment planner"}
        for mode_id, cm in get_plugin_chat_modes().items():
            modes[mode_id] = cm.label

        # Direct argument: /mode planner
        if arg and arg in modes:
            state["mode"] = arg
            state["messages"].clear()
            state["choices"] = []
            console.print(f"  [green]Mode set to {arg} — conversation cleared.[/green]")
            return False
        if arg:
            console.print(f"  [red]Unknown mode: {arg}. Available: {', '.join(modes.keys())}[/red]")
            return False

        # Interactive picker
        items = [{"name": f"{label} ({mid})", "id": mid} for mid, label in modes.items()]
        current = state.get("mode", "discussion")
        console.print(f"  Current mode: [cyan]{current}[/cyan]")
        picked = await _pick_from_list(items, "name", "id", "Select Chat Mode")
        if picked:
            state["mode"] = picked
            state["messages"].clear()
            state["choices"] = []
            console.print(f"  [green]Mode set to {picked} — conversation cleared.[/green]")
        return False

    if cmd == "/help":
        table = Table(border_style="bright_blue", show_header=False)
        table.add_column("Command", style="bold cyan")
        table.add_column("Description", style="white")
        for cmd_name, desc in _SLASH_COMMANDS.items():
            table.add_row(cmd_name, desc)
        console.print(table)
        return False

    if cmd == "/context":
        console.print(f"  Tenant:       [cyan]{state.get('tenant_id') or 'not set'}[/cyan]")
        console.print(f"  Subscription: [cyan]{state.get('subscription_id') or 'not set'}[/cyan]")
        console.print(f"  Region:       [cyan]{state.get('region') or 'not set'}[/cyan]")
        console.print(f"  Mode:         [cyan]{state.get('mode', 'discussion')}[/cyan]")
        return False

    if cmd == "/tenant":
        from az_scout.azure_api.discovery import list_tenants

        try:
            result = list_tenants()
            tenants: list[dict[str, Any]] = result.get("tenants", [])
            items = [{"name": t["name"], "id": t["id"]} for t in tenants]

            # Direct argument: /tenant <id-or-name>
            if arg:
                match = next(
                    (t for t in tenants if t["id"] == arg or t["name"].lower() == arg),
                    None,
                )
                if match:
                    state["tenant_id"] = match["id"]
                    state["subscription_id"] = None
                    console.print(f"  [green]Tenant set to {match['name']}[/green]")
                else:
                    names = ", ".join(t["name"] for t in tenants)
                    console.print(f"  [red]Unknown tenant: {arg}. Available: {names}[/red]")
                return False

            # Interactive picker
            picked = await _pick_from_list(items, "name", "id", "Select Tenant")
            if picked:
                state["tenant_id"] = picked
                state["subscription_id"] = None
                console.print(f"  [green]Tenant set to {picked}[/green]")
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    if cmd == "/subscription":
        from az_scout.azure_api.discovery import list_subscriptions

        try:
            subs = list_subscriptions(tenant_id=state.get("tenant_id"))
            items = [{"name": s["name"], "id": s["id"]} for s in subs]

            # Direct argument: /subscription <id-or-name>
            if arg:
                match = next(
                    (s for s in subs if s["id"] == arg or s["name"].lower() == arg),
                    None,
                )
                if match:
                    state["subscription_id"] = match["id"]
                    console.print(f"  [green]Subscription set to {match['name']}[/green]")
                else:
                    names = ", ".join(s["name"] for s in subs)
                    console.print(f"  [red]Unknown subscription: {arg}. Available: {names}[/red]")
                return False

            # Interactive picker
            picked = await _pick_from_list(items, "name", "id", "Select Subscription")
            if picked:
                state["subscription_id"] = picked
                console.print(f"  [green]Subscription set to {picked}[/green]")
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    if cmd == "/region":
        from az_scout.azure_api.discovery import list_regions

        try:
            sub_for_regions = state.get("subscription_id")
            if not sub_for_regions:
                from az_scout.azure_api.discovery import list_subscriptions as _list_subs

                subs = _list_subs(tenant_id=state.get("tenant_id"))
                if subs:
                    sub_for_regions = subs[0]["id"]
            regions = list_regions(
                subscription_id=sub_for_regions, tenant_id=state.get("tenant_id")
            )
            items = [
                {"name": r.get("displayName", r.get("name", "?")), "id": r.get("name", "")}
                for r in regions
            ]

            # Direct argument: /region <name>
            if arg:
                valid_names = [r.get("name", "") for r in regions]
                if arg in valid_names:
                    state["region"] = arg
                    console.print(f"  [green]Region set to {arg}[/green]")
                else:
                    console.print(
                        f"  [red]Unknown region: {arg}. "
                        f"Type /regions to see available regions.[/red]"
                    )
                return False

            # Interactive picker
            picked = await _pick_from_list(items, "name", "id", "Select Region")
            if picked:
                state["region"] = picked
                console.print(f"  [green]Region set to {picked}[/green]")
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    # ---- MCP tool shortcuts (read-only data display) ----

    if cmd == "/tenants":
        from az_scout.azure_api.discovery import list_tenants

        try:
            result = list_tenants(tenant_id=state.get("tenant_id"))
            tenants_list: list[dict[str, Any]] = result.get("tenants", [])
            table = Table(title="Tenants", border_style="bright_blue", show_lines=False)
            table.add_column("Name", style="white")
            table.add_column("ID", style="dim")
            table.add_column("Auth", style="green")
            for t in tenants_list:
                auth = "✓" if t.get("authenticated") else "✗"
                auth_style = "green" if t.get("authenticated") else "red"
                table.add_row(t["name"], t["id"], Text(auth, style=auth_style))
            console.print(table)
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    if cmd == "/subscriptions":
        from az_scout.azure_api.discovery import list_subscriptions

        try:
            subs = list_subscriptions(tenant_id=state.get("tenant_id"))
            table = Table(title="Subscriptions", border_style="bright_blue", show_lines=False)
            table.add_column("Name", style="white")
            table.add_column("ID", style="dim")
            for s in subs:
                table.add_row(s["name"], s["id"])
            console.print(table)
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    if cmd == "/regions":
        from az_scout.azure_api.discovery import list_regions

        try:
            sub_for_regions = state.get("subscription_id")
            if not sub_for_regions:
                from az_scout.azure_api.discovery import list_subscriptions

                subs = list_subscriptions(tenant_id=state.get("tenant_id"))
                if subs:
                    sub_for_regions = subs[0]["id"]
            regions = list_regions(
                subscription_id=sub_for_regions, tenant_id=state.get("tenant_id")
            )
            table = Table(title="AZ-Enabled Regions", border_style="bright_blue", show_lines=False)
            table.add_column("Name", style="cyan")
            table.add_column("Display Name", style="white")
            for r in regions:
                table.add_row(r.get("name", "?"), r.get("displayName", ""))
            console.print(table)
        except Exception as exc:
            console.print(f"  [red]Failed: {exc}[/red]")
        return False

    console.print(f"  [red]Unknown command: {cmd}. Type /help for options.[/red]")
    return False


async def run_cli_chat(initial_prompt: str | None = None) -> None:
    """Main entry point for the interactive CLI chat session."""
    if not is_chat_enabled():
        console.print(
            Panel(
                "[bold red]Azure OpenAI is not configured.[/bold red]\n\n"
                "Set these environment variables:\n"
                "  • AZURE_OPENAI_ENDPOINT\n"
                "  • AZURE_OPENAI_API_KEY\n"
                "  • AZURE_OPENAI_DEPLOYMENT",
                title="[bold red]Configuration Error[/bold red]",
                border_style="red",
            )
        )
        return

    # Register internal + external plugins so their MCP tools are available
    _register_cli_tools()

    # Resolve initial context
    tenant_id, subscription_id, region = await _resolve_context()

    console.print()
    console.print(_render_welcome(tenant_id, region, subscription_id))
    console.print()

    # Session state — mutated by slash commands
    state: dict[str, Any] = {
        "tenant_id": tenant_id,
        "subscription_id": subscription_id,
        "region": region,
        "mode": "discussion",
        "messages": [],
        "choices": [],
    }

    session: PromptSession[str] = PromptSession(
        history=InMemoryHistory(),
        completer=_SlashCompleter(),
    )

    # If an initial prompt was provided, process it first
    if initial_prompt:
        console.print(f"  [bold bright_green]you ❯[/bold bright_green] {initial_prompt}")
        console.print()
        state["messages"].append({"role": "user", "content": initial_prompt})
        _, state["choices"] = await _stream_response(
            state["messages"],
            tenant_id=state["tenant_id"],
            region=state["region"],
            subscription_id=state["subscription_id"],
            mode=state["mode"],
        )

    while True:
        try:
            user_input = await session.prompt_async(
                HTML("<style fg='ansibrightgreen'><b>you ❯ </b></style>"),
            )
        except KeyboardInterrupt:
            # Ctrl+C — clear the current input, show a fresh prompt
            console.print()
            continue
        except EOFError:
            # Ctrl+D — exit
            console.print("\n  [dim]Goodbye![/dim]")
            break

        user_input = user_input.strip()
        if not user_input:
            continue

        # Handle numbered choice selection
        if state["choices"] and user_input.isdigit():
            idx = int(user_input) - 1
            if 0 <= idx < len(state["choices"]):
                user_input = state["choices"][idx]
                console.print(f"  [dim]→ {user_input}[/dim]")
            state["choices"] = []

        # Handle slash commands
        if user_input.startswith("/"):
            should_exit = await _handle_slash_command(user_input, state)
            if should_exit:
                console.print("  [dim]Goodbye![/dim]")
                break
            continue

        # Regular message — send to AI
        state["messages"].append({"role": "user", "content": user_input})
        console.print()

        full_text, state["choices"] = await _stream_response(
            state["messages"],
            tenant_id=state["tenant_id"],
            region=state["region"],
            subscription_id=state["subscription_id"],
            mode=state["mode"],
        )

        # Track assistant response in conversation history
        if full_text.strip():
            state["messages"].append({"role": "assistant", "content": full_text})
