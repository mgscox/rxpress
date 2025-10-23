"""Control plane client for rxpress handler bridge."""

from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import grpc

from .generated import handler_bridge_pb2 as bridge_pb
from .generated import handler_bridge_pb2_grpc as bridge_pb2_grpc
from .value_codec import decode_value, encode_value

LOGGER = logging.getLogger(__name__)


@dataclass
class PendingResult:
    event: threading.Event = field(default_factory=threading.Event)
    response: Optional[bridge_pb.Control] = None
    error: Optional[Exception] = None

    def set(self, response: bridge_pb.Control) -> None:
        self.response = response
        self.event.set()

    def set_error(self, exc: Exception) -> None:
        self.error = exc
        self.event.set()

    def wait(self, timeout: Optional[float] = None) -> bridge_pb.Control:
        if not self.event.wait(timeout):
            raise TimeoutError("control-plane response timed out")
        if self.error:
            raise self.error
        assert self.response is not None
        return self.response


class ControlPlaneClient:
    """Maintains the duplex ControlPlane stream."""

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = bridge_pb2_grpc.ControlPlaneStub(channel)
        self._lock = threading.Lock()
        self._pending: Dict[str, PendingResult] = {}
        self._outgoing: "queue.Queue[Optional[bridge_pb.Control]]" = queue.Queue()
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, name="rxpress-control", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        self._outgoing.put(None)
        self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stopped.is_set():
            try:
                responses = self._stub.Connect(self._request_iterator())
                for response in responses:
                    correlation = response.correlation
                    if not correlation:
                        continue
                    with self._lock:
                        waiter = self._pending.pop(correlation, None)
                    if waiter:
                        waiter.set(response)
            except grpc.RpcError as exc:  # pragma: no cover - network failure path
                LOGGER.error("control plane stream failed: %s", exc)
                with self._lock:
                    pending = list(self._pending.values())
                    self._pending.clear()
                for waiter in pending:
                    waiter.set_error(exc)
                time.sleep(0.5)

    def _request_iterator(self):
        while not self._stopped.is_set():
            try:
                message = self._outgoing.get(timeout=0.1)
            except queue.Empty:
                continue

            if message is None:
                return

            yield message

    def _queue(self, message: bridge_pb.Control, expect_reply: bool = False) -> PendingResult:
        correlation = message.correlation or getattr(message, "correlation", None)
        if not correlation:
            correlation = __import__("uuid").uuid4().hex
            message.correlation = correlation

        waiter: Optional[PendingResult] = None
        if expect_reply:
            waiter = PendingResult()
            with self._lock:
                self._pending[correlation] = waiter

        self._outgoing.put(message)
        return waiter or PendingResult()

    def log(self, level: str, msg: str, fields: Dict[str, Any] | None = None, meta: Dict[str, Any] | None = None) -> None:
        control = bridge_pb.Control(
            log=bridge_pb.LogReq(
                level=level,
                msg=msg,
                fields={k: encode_value(v).to_proto() for k, v in (fields or {}).items()},
            )
        )
        if meta:
            control.meta.CopyFrom(_to_meta(meta))
        self._queue(control, expect_reply=False)

    def emit(self, topic: str, data: Dict[str, Any], meta: Dict[str, Any] | None = None) -> None:
        control = bridge_pb.Control(
            emit=bridge_pb.EmitReq(
                topic=topic,
                data={k: encode_value(v).to_proto() for k, v in data.items()},
            )
        )
        if meta:
            control.meta.CopyFrom(_to_meta(meta))
        waiter = self._queue(control, expect_reply=True)
        waiter.wait(timeout=5)

    def kv_get(self, bucket: str, key: str) -> Any:
        control = bridge_pb.Control(
            kv_get=bridge_pb.KVGetReq(bucket=bucket, key=key)
        )
        waiter = self._queue(control, expect_reply=True)
        response = waiter.wait(timeout=5)
        if response.WhichOneof("oneof_msg") != "kv_get_res":
            raise RuntimeError("unexpected control-plane response")
        status = response.kv_get_res.status
        if status.code != 0:
            raise RuntimeError(status.message or "kv_get failed")
        return decode_value(response.kv_get_res.value)

    def kv_put(self, bucket: str, key: str, value: Any, ttl_sec: int | None = None) -> None:
        control = bridge_pb.Control(
            kv_put=bridge_pb.KVPutReq(
                bucket=bucket,
                key=key,
                value=encode_value(value).to_proto(),
                ttl_sec=ttl_sec or 0,
            )
        )
        waiter = self._queue(control, expect_reply=True)
        response = waiter.wait(timeout=5)
        if response.WhichOneof("oneof_msg") != "kv_common_res":
            raise RuntimeError("unexpected control-plane response")
        status = response.kv_common_res.status
        if status.code != 0:
            raise RuntimeError(status.message or "kv_put failed")

    def kv_del(self, bucket: str, key: str) -> None:
        control = bridge_pb.Control(
            kv_del=bridge_pb.KVDelReq(bucket=bucket, key=key)
        )
        waiter = self._queue(control, expect_reply=True)
        response = waiter.wait(timeout=5)
        if response.WhichOneof("oneof_msg") != "kv_common_res":
            raise RuntimeError("unexpected control-plane response")
        status = response.kv_common_res.status
        if status.code != 0:
            raise RuntimeError(status.message or "kv_del failed")


def _to_meta(meta: Dict[str, Any]) -> bridge_pb.Meta:
    message = bridge_pb.Meta()
    if trace := meta.get("trace_id"):
        message.trace_id = str(trace)
    if span := meta.get("span_id"):
        message.span_id = str(span)
    if tenant := meta.get("tenant"):
        message.tenant = str(tenant)
    baggage = meta.get("baggage")
    if isinstance(baggage, dict):
        message.baggage.update({str(k): str(v) for k, v in baggage.items()})
    return message
