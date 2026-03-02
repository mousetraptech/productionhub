from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from agent.config import AgentConfig
from agent.services.process import ProcessService

logger = logging.getLogger(__name__)


async def heartbeat_loop(config: AgentConfig, process_service: ProcessService) -> None:
    url = f"{config.hub_url}/api/v1/nodes/{config.node_id}/heartbeat"
    interval = config.heartbeat_interval_seconds

    logger.info("Heartbeat started: %s every %ds", url, interval)

    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                processes = process_service.list_processes()
                alerts: list[str] = []

                for p in processes:
                    if not p["running"]:
                        alerts.append(f"{p['display_name']} is not running")

                payload = {
                    "node_id": config.node_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "healthy": len(alerts) == 0,
                    "processes": [{"name": p["name"], "running": p["running"]} for p in processes],
                    "alerts": alerts,
                }

                await client.post(url, json=payload)
                logger.debug("Heartbeat sent")
            except httpx.ConnectError:
                logger.warning("Hub unreachable at %s", config.hub_url)
            except Exception:
                logger.warning("Heartbeat failed", exc_info=True)

            await asyncio.sleep(interval)
