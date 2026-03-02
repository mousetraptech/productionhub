"""Plugin registry for process-specific meta handlers.

Future: register handlers like OBSMetaHandler that query OBS WebSocket
for scene/recording state, populating the `meta` field in process responses.
"""

_registry: dict[str, object] = {}
