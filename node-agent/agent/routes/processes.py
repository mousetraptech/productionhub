from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()


class StartRequest(BaseModel):
    args: list[str] = Field(default_factory=list)


class StopRequest(BaseModel):
    force: bool = False


def _svc(request: Request):
    return request.app.state.process_service


@router.get("/processes")
async def list_processes(request: Request):
    return {"processes": _svc(request).list_processes()}


@router.get("/processes/{name}")
async def get_process(name: str, request: Request):
    result = _svc(request).get_process(name)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Process '{name}' not managed")
    return result


@router.post("/processes/{name}/start")
async def start_process(name: str, request: Request, body: StartRequest | None = None) -> dict[str, Any]:
    result = _svc(request).start_process(name, body.args if body else None)
    if not result["success"]:
        raise HTTPException(status_code=400 if result["code"] != "PERMISSION_DENIED" else 403, detail=result)
    return result


@router.post("/processes/{name}/stop")
async def stop_process(name: str, request: Request, body: StopRequest | None = None) -> dict[str, Any]:
    result = _svc(request).stop_process(name, force=body.force if body else False)
    if not result["success"]:
        raise HTTPException(status_code=400 if result["code"] != "PERMISSION_DENIED" else 403, detail=result)
    return result
