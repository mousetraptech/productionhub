from __future__ import annotations

import logging
import subprocess
import time
from typing import Any

import psutil

from agent.config import AgentConfig, ManagedProcess

logger = logging.getLogger(__name__)

# Error codes
EXEC_NOT_FOUND = "EXEC_NOT_FOUND"
ALREADY_RUNNING = "ALREADY_RUNNING"
NOT_RUNNING = "NOT_RUNNING"
NOT_MANAGED = "NOT_MANAGED"
START_FAILED = "START_FAILED"
PERMISSION_DENIED = "PERMISSION_DENIED"


class ProcessService:
    def __init__(self, config: AgentConfig):
        self._config = config
        self._managed: dict[str, ManagedProcess] = {p.name: p for p in config.managed_processes}
        self._started_pids: dict[str, int] = {}  # processes we launched

    def _find_running(self, proc_cfg: ManagedProcess) -> psutil.Process | None:
        exe_lower = proc_cfg.executable.replace("\\", "/").lower()
        exe_name = exe_lower.rsplit("/", 1)[-1]
        for p in psutil.process_iter(["pid", "name", "exe"]):
            try:
                p_exe = (p.info["exe"] or "").replace("\\", "/").lower()
                p_name = (p.info["name"] or "").lower()
                if p_exe == exe_lower or p_name == exe_name:
                    return p
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return None

    def list_processes(self) -> list[dict[str, Any]]:
        result = []
        for proc_cfg in self._config.managed_processes:
            running = self._find_running(proc_cfg)
            result.append({
                "name": proc_cfg.name,
                "display_name": proc_cfg.display_name or proc_cfg.name,
                "running": running is not None,
                "pid": running.pid if running else None,
                "uptime_seconds": int(time.time() - running.create_time()) if running else None,
                "managed": True,
            })
        return result

    def get_process(self, name: str) -> dict[str, Any] | None:
        proc_cfg = self._managed.get(name)
        if not proc_cfg:
            return None
        running = self._find_running(proc_cfg)
        return {
            "name": proc_cfg.name,
            "display_name": proc_cfg.display_name or proc_cfg.name,
            "running": running is not None,
            "pid": running.pid if running else None,
            "uptime_seconds": int(time.time() - running.create_time()) if running else None,
            "managed": True,
            "meta": None,
        }

    def start_process(self, name: str, args: list[str] | None = None) -> dict[str, Any]:
        proc_cfg = self._managed.get(name)
        if not proc_cfg:
            return _err(name, NOT_MANAGED, f"Process '{name}' is not managed by this agent")

        import os
        if not os.path.isfile(proc_cfg.executable):
            return _err(name, EXEC_NOT_FOUND, f"Executable not found: {proc_cfg.executable}")

        if self._find_running(proc_cfg):
            return _err(name, ALREADY_RUNNING, f"'{proc_cfg.display_name}' is already running")

        cmd = [proc_cfg.executable] + proc_cfg.start_args + (args or [])
        try:
            proc = subprocess.Popen(cmd, start_new_session=True)
        except PermissionError:
            return _err(name, PERMISSION_DENIED, f"Permission denied launching {proc_cfg.executable}")
        except Exception as e:
            return _err(name, START_FAILED, str(e))

        # Give it a moment to crash or stay alive
        time.sleep(0.5)
        if proc.poll() is not None:
            return _err(name, START_FAILED, f"Process exited immediately with code {proc.returncode}")

        self._started_pids[name] = proc.pid
        return {
            "success": True,
            "name": name,
            "pid": proc.pid,
            "message": f"Started '{proc_cfg.display_name}' (PID {proc.pid})",
            "error": None,
            "code": None,
        }

    def stop_process(self, name: str, force: bool = False) -> dict[str, Any]:
        proc_cfg = self._managed.get(name)
        if not proc_cfg:
            return _err(name, NOT_MANAGED, f"Process '{name}' is not managed by this agent")

        running = self._find_running(proc_cfg)
        if not running:
            return _err(name, NOT_RUNNING, f"'{proc_cfg.display_name}' is not running")

        try:
            if not force and proc_cfg.stop_graceful:
                running.terminate()
                try:
                    running.wait(timeout=5)
                    self._started_pids.pop(name, None)
                    return _ok(name, f"Gracefully stopped '{proc_cfg.display_name}'")
                except psutil.TimeoutExpired:
                    logger.warning("Graceful stop timed out for %s, force killing", name)

            running.kill()
            running.wait(timeout=3)
            self._started_pids.pop(name, None)
            return _ok(name, f"Force killed '{proc_cfg.display_name}'")
        except psutil.AccessDenied:
            return _err(name, PERMISSION_DENIED, f"Permission denied stopping {proc_cfg.display_name}")
        except Exception as e:
            return _err(name, None, str(e))


def _ok(name: str, message: str) -> dict[str, Any]:
    return {"success": True, "name": name, "message": message, "error": None, "code": None}


def _err(name: str, code: str | None, message: str) -> dict[str, Any]:
    return {"success": False, "name": name, "pid": None, "message": message, "error": message, "code": code}
