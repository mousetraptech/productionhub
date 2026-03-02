from __future__ import annotations

from fastapi import APIRouter, Request

from agent.services.system import get_system_info

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    config = request.app.state.config
    return get_system_info(config.node_id, request.app.state.agent_version)
