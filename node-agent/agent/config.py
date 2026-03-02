from __future__ import annotations

import logging
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


class AuthConfig(BaseModel):
    enabled: bool = False
    token: str = ""


class ManagedProcess(BaseModel):
    name: str
    display_name: str = ""
    executable: str
    start_args: list[str] = Field(default_factory=list)
    stop_graceful: bool = True


class AgentConfig(BaseModel):
    node_id: str
    hub_url: str = "http://localhost:9000"
    heartbeat_interval_seconds: int = 10
    auth: AuthConfig = Field(default_factory=AuthConfig)
    managed_processes: list[ManagedProcess] = Field(default_factory=list)


def load_config(path: Path | str | None = None) -> AgentConfig:
    path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not path.exists():
        logger.warning("Config file not found at %s, using defaults", path)
        return AgentConfig(node_id="unnamed-node")

    with open(path) as f:
        raw = yaml.safe_load(f) or {}

    config = AgentConfig(**raw)
    logger.info("Loaded config for node '%s' with %d managed processes", config.node_id, len(config.managed_processes))
    return config
