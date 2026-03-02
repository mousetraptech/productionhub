from __future__ import annotations

import logging

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        config = request.app.state.config

        if not config.auth.enabled:
            logger.debug("Auth disabled, passing through")
            return await call_next(request)

        token = request.headers.get("X-Hub-Token")
        if not token or token != config.auth.token:
            return Response(content='{"detail":"Unauthorized"}', status_code=401, media_type="application/json")

        return await call_next(request)
