from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/config")
async def get_config(request: Request):
    config = request.app.state.config
    return {
        "node_id": config.node_id,
        "hub_url": config.hub_url,
        "heartbeat_interval_seconds": config.heartbeat_interval_seconds,
        "managed_processes": [
            {
                "name": p.name,
                "executable": p.executable,
                "start_args": p.start_args,
                "stop_graceful": p.stop_graceful,
            }
            for p in config.managed_processes
        ],
    }
