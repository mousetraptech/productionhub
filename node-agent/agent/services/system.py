from __future__ import annotations

import logging
import time
from typing import Any

import psutil

logger = logging.getLogger(__name__)

_boot_time: float = psutil.boot_time()


def _get_gpu_info() -> dict[str, Any] | None:
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        if not gpus:
            return None
        gpu = gpus[0]
        return {
            "name": gpu.name,
            "utilization_percent": int(gpu.load * 100),
            "temp_c": int(gpu.temperature) if gpu.temperature else None,
            "vram_used_gb": round(gpu.memoryUsed / 1024, 2),
            "vram_total_gb": round(gpu.memoryTotal / 1024, 2),
        }
    except Exception:
        logger.debug("GPU info unavailable", exc_info=True)
        return None


def get_system_info(node_id: str, agent_version: str) -> dict[str, Any]:
    mem = psutil.virtual_memory()
    disks = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "mount": part.mountpoint,
                "free_gb": round(usage.free / (1024 ** 3), 2),
                "total_gb": round(usage.total / (1024 ** 3), 2),
            })
        except PermissionError:
            continue

    return {
        "node_id": node_id,
        "timestamp": _iso_now(),
        "system": {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "ram_percent": mem.percent,
            "ram_available_gb": round(mem.available / (1024 ** 3), 2),
            "disk": disks,
            "gpu": _get_gpu_info(),
        },
        "uptime_seconds": int(time.time() - _boot_time),
        "agent_version": agent_version,
    }


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
