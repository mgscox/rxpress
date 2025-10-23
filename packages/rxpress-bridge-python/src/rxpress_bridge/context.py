"""Context passed to Python handlers executing via the rxpress gRPC bridge."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from .control import ControlPlaneClient


@dataclass
class BridgeContext:
    control: ControlPlaneClient
    meta: Dict[str, Any]
    run_id: Optional[str] = None

    def log(self, level: str, message: str, fields: Dict[str, Any] | None = None) -> None:
        payload = dict(fields or {})
        if self.run_id and "runId" not in payload:
            payload["runId"] = self.run_id
        self.control.log(level, message, payload, self.meta)

    async def emit(self, topic: str, data: Dict[str, Any]) -> None:
        # Control plane is synchronous for now; wrap in coroutine for parity with async handlers.
        self.control.emit(topic, data, self.meta)

    async def kv_get(self, bucket: str, key: str) -> Any:
        return self.control.kv_get(bucket, key)

    async def kv_put(self, bucket: str, key: str, value: Any, ttl_sec: int | None = None) -> None:
        self.control.kv_put(bucket, key, value, ttl_sec)

    async def kv_del(self, bucket: str, key: str) -> None:
        self.control.kv_del(bucket, key)
