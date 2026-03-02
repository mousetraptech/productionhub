from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from agent import __version__
from agent.config import load_config
from agent.middleware.auth import AuthMiddleware
from agent.routes.config_route import router as config_router
from agent.routes.health import router as health_router
from agent.routes.processes import router as processes_router
from agent.services.heartbeat import heartbeat_loop
from agent.services.process import ProcessService

logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG") else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)
logger = logging.getLogger("agent")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_path = os.getenv("AGENT_CONFIG", None)
    config = load_config(config_path)
    app.state.config = config
    app.state.agent_version = __version__
    app.state.process_service = ProcessService(config)

    heartbeat_task = asyncio.create_task(heartbeat_loop(config, app.state.process_service))
    logger.info("Node agent v%s started — node_id=%s", __version__, config.node_id)
    try:
        yield
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        logger.info("Node agent shut down")


app = FastAPI(
    title="Production Hub Node Agent",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(AuthMiddleware)
app.include_router(health_router, prefix="/api/v1")
app.include_router(processes_router, prefix="/api/v1")
app.include_router(config_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.main:app", host="0.0.0.0", port=9400, reload=True)
