from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agent.services import prompt as prompt_service

router = APIRouter()


class PromptRequest(BaseModel):
    type: str  # text_input, choice, confirm
    title: str = "Input Required"
    message: str = "Please enter a value:"
    default: str = ""
    choices: list[str] = Field(default_factory=list)
    timeout_seconds: int = Field(default=60, ge=5, le=300)


class PromptResponse(BaseModel):
    success: bool
    result: str | None
    cancelled: bool
    timed_out: bool
    error: str | None = None


@router.post("/prompt", response_model=PromptResponse)
async def prompt_user(body: PromptRequest):
    """Display a native OS dialog and return user input."""

    if prompt_service.is_busy():
        raise HTTPException(409, "A prompt is already being displayed")

    if body.type == "choice" and len(body.choices) < 2:
        raise HTTPException(400, "Choice prompts require at least 2 choices")

    async with prompt_service._prompt_lock:
        if body.type == "text_input":
            r = await prompt_service.text_input(
                body.title, body.message, body.default, body.timeout_seconds,
            )
        elif body.type == "choice":
            r = await prompt_service.choice(
                body.title, body.message, body.choices, body.timeout_seconds,
            )
        elif body.type == "confirm":
            r = await prompt_service.confirm(
                body.title, body.message, body.timeout_seconds,
            )
        else:
            raise HTTPException(400, f"Unknown prompt type: {body.type}")

    return PromptResponse(
        success=not r.timed_out and r.error is None,
        result=r.result,
        cancelled=r.cancelled,
        timed_out=r.timed_out,
        error=r.error,
    )
