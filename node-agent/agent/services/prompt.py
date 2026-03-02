from __future__ import annotations

import asyncio
import logging
import platform
import subprocess
from dataclasses import dataclass

logger = logging.getLogger("agent.services.prompt")

# Lock to reject concurrent prompts — only one dialog on screen at a time.
_prompt_lock = asyncio.Lock()


@dataclass
class PromptResult:
    result: str | None
    cancelled: bool
    timed_out: bool
    error: str | None = None


def is_busy() -> bool:
    """Check if a prompt is currently being displayed."""
    return _prompt_lock.locked()


async def text_input(
    title: str,
    message: str,
    default: str = "",
    timeout_seconds: int = 60,
) -> PromptResult:
    """Display a text input dialog and return the user's input."""
    system = platform.system()
    if system == "Darwin":
        return await _macos_text_input(title, message, default, timeout_seconds)
    elif system == "Windows":
        return await _windows_text_input(title, message, default, timeout_seconds)
    return PromptResult(None, False, False, f"Unsupported platform: {system}")


async def choice(
    title: str,
    message: str,
    choices: list[str],
    timeout_seconds: int = 60,
) -> PromptResult:
    """Display a choice dialog with buttons."""
    system = platform.system()
    if system == "Darwin":
        return await _macos_choice(title, message, choices, timeout_seconds)
    elif system == "Windows":
        return await _windows_choice(title, message, choices, timeout_seconds)
    return PromptResult(None, False, False, f"Unsupported platform: {system}")


async def confirm(
    title: str,
    message: str,
    timeout_seconds: int = 30,
) -> PromptResult:
    """Display a Yes/No confirmation dialog."""
    return await choice(title, message, ["Yes", "No"], timeout_seconds)


# -- macOS (osascript) --------------------------------------------------------


def _osa_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


async def _run_osascript(script: str, timeout: int) -> PromptResult:
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout + 5,
        )
        result = stdout.decode().strip()
        if result == "<<CANCELLED>>":
            return PromptResult(None, cancelled=True, timed_out=False)
        if result == "<<TIMEOUT>>":
            return PromptResult(None, cancelled=False, timed_out=True)
        return PromptResult(result, cancelled=False, timed_out=False)
    except asyncio.TimeoutError:
        return PromptResult(None, cancelled=False, timed_out=True, error="Process timed out")
    except Exception as e:
        return PromptResult(None, cancelled=False, timed_out=False, error=str(e))


async def _macos_text_input(
    title: str, message: str, default: str, timeout: int,
) -> PromptResult:
    script = f'''
        try
            set dialogResult to display dialog "{_osa_escape(message)}" \u00ac
                with title "{_osa_escape(title)}" \u00ac
                default answer "{_osa_escape(default)}" \u00ac
                giving up after {timeout}
            if gave up of dialogResult then
                return "<<TIMEOUT>>"
            else
                return text returned of dialogResult
            end if
        on error number -128
            return "<<CANCELLED>>"
        end try
    '''
    return await _run_osascript(script, timeout)


async def _macos_choice(
    title: str, message: str, choices: list[str], timeout: int,
) -> PromptResult:
    buttons_str = ", ".join(f'"{_osa_escape(c)}"' for c in choices)
    script = f'''
        try
            set dialogResult to display dialog "{_osa_escape(message)}" \u00ac
                with title "{_osa_escape(title)}" \u00ac
                buttons {{{buttons_str}}} \u00ac
                giving up after {timeout}
            if gave up of dialogResult then
                return "<<TIMEOUT>>"
            else
                return button returned of dialogResult
            end if
        on error number -128
            return "<<CANCELLED>>"
        end try
    '''
    return await _run_osascript(script, timeout)


# -- Windows (PowerShell) -----------------------------------------------------


async def _run_powershell(script: str, timeout: int) -> PromptResult:
    try:
        proc = await asyncio.create_subprocess_exec(
            "powershell", "-NoProfile", "-Command", script,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout + 5,
        )
        result = stdout.decode().strip()
        if result == "<<CANCELLED>>":
            return PromptResult(None, cancelled=True, timed_out=False)
        if result == "<<TIMEOUT>>":
            return PromptResult(None, cancelled=False, timed_out=True)
        return PromptResult(result, cancelled=False, timed_out=False)
    except asyncio.TimeoutError:
        return PromptResult(None, cancelled=False, timed_out=True, error="Process timed out")
    except Exception as e:
        return PromptResult(None, cancelled=False, timed_out=False, error=str(e))


def _ps_escape(s: str) -> str:
    return s.replace("'", "''")


async def _windows_text_input(
    title: str, message: str, default: str, timeout: int,
) -> PromptResult:
    script = (
        "Add-Type -AssemblyName Microsoft.VisualBasic; "
        f"$r = [Microsoft.VisualBasic.Interaction]::InputBox('{_ps_escape(message)}', "
        f"'{_ps_escape(title)}', '{_ps_escape(default)}'); "
        "if ($r -eq '') { '<<CANCELLED>>' } else { $r }"
    )
    return await _run_powershell(script, timeout)


async def _windows_choice(
    title: str, message: str, choices: list[str], timeout: int,
) -> PromptResult:
    # Use WPF MessageBox for simple Yes/No, WinForms for custom buttons
    if sorted(choices) == ["No", "Yes"]:
        script = (
            "Add-Type -AssemblyName PresentationFramework; "
            f"$r = [System.Windows.MessageBox]::Show('{_ps_escape(message)}', "
            f"'{_ps_escape(title)}', 'YesNo'); "
            "$r.ToString()"
        )
    else:
        # Build a simple form with buttons
        btns = "; ".join(
            f"$b{i} = New-Object System.Windows.Forms.Button; "
            f"$b{i}.Text = '{_ps_escape(c)}'; "
            f"$b{i}.DialogResult = {i + 1}; "
            f"$b{i}.Location = New-Object System.Drawing.Point({10 + i * 110}, 60); "
            f"$f.Controls.Add($b{i})"
            for i, c in enumerate(choices)
        )
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.Form; "
            f"$f.Text = '{_ps_escape(title)}'; "
            "$f.StartPosition = 'CenterScreen'; "
            f"$f.Width = {max(300, len(choices) * 120)}; $f.Height = 140; "
            "$l = New-Object System.Windows.Forms.Label; "
            f"$l.Text = '{_ps_escape(message)}'; "
            "$l.Location = New-Object System.Drawing.Point(10, 10); "
            "$l.AutoSize = $true; $f.Controls.Add($l); "
            f"{btns}; "
            "$r = $f.ShowDialog(); "
            "if ($r -le 0) { '<<CANCELLED>>' } else { "
            + " ".join(
                f"if ($r -eq {i + 1}) {{ '{_ps_escape(c)}' }}"
                for i, c in enumerate(choices)
            )
            + " }"
        )
    return await _run_powershell(script, timeout)
