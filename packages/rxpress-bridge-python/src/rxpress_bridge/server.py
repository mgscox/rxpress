"""Bridge server that hosts rxpress handlers in Python."""

from __future__ import annotations

import logging
from concurrent import futures
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

import grpc

from .context import BridgeContext
from .control import ControlPlaneClient
from .generated import handler_bridge_pb2 as bridge_pb
from .generated import handler_bridge_pb2_grpc as bridge_pb2_grpc
from .value_codec import decode_value, encode_value

LOGGER = logging.getLogger(__name__)

HandlerFn = Callable[[str, Dict[str, Any], Dict[str, Any], BridgeContext], Awaitable[Dict[str, Any]] | Dict[str, Any]]


class _BridgeInvoker(bridge_pb2_grpc.InvokerServicer):
    """Hosts the Invoker service and maintains handler registrations."""

    def __init__(self, handlers: Dict[str, HandlerFn], control_target: str) -> None:
        self._handlers = handlers
        channel = grpc.insecure_channel(control_target)
        self._control = ControlPlaneClient(channel)
        self._control.start()

    def stop(self) -> None:
        self._control.stop()

    def Invoke(self, request: bridge_pb.InvokeRequest, context: grpc.ServicerContext) -> bridge_pb.InvokeResponse:  # noqa: N802
        handler = self._handlers.get(request.handler_name)
        response = bridge_pb.InvokeResponse(correlation=request.correlation)

        if not handler:
            response.status.code = 1
            response.status.message = f"handler not found: {request.handler_name}"
            return response

        meta = _meta_to_dict(request.meta)
        ctx = BridgeContext(control=self._control, meta=meta, run_id=meta.get("run_id"))
        input_map = {k: decode_value(v) for k, v in request.input.items()}

        try:
            result = handler(request.method, input_map, meta, ctx)
            if hasattr(result, "__await__"):
                result = _run_sync(result)

            for key, value in (result or {}).items():
                response.output[key].CopyFrom(encode_value(value).to_proto())
            response.status.code = 0
            return response
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.exception("handler %s failed", request.handler_name)
            response.status.code = 1
            response.status.message = str(exc)
            return response


def _run_sync(awaitable: Awaitable[Dict[str, Any]]) -> Dict[str, Any]:
    # Minimal async runner—fine for short awaited blocks. A production version may want to use an
    # event loop or thread pool.
    import asyncio

    return asyncio.run(awaitable)


def _meta_to_dict(meta: bridge_pb.Meta) -> Dict[str, Any]:
    return {
        "trace_id": meta.trace_id,
        "span_id": meta.span_id,
        "tenant": meta.tenant,
        "baggage": dict(meta.baggage),
    }


@dataclass
class BridgeApp:
    server: grpc.Server
    invoker: _BridgeInvoker

    def wait_forever(self) -> None:
        self.server.wait_for_termination()

    def stop(self, grace: float | None = None) -> None:
        try:
            self.invoker.stop()
        finally:
            self.server.stop(grace or 0)


def serve(bind: str, handlers: Dict[str, HandlerFn], control_target: str) -> BridgeApp:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    invoker = _BridgeInvoker(handlers, control_target)
    bridge_pb2_grpc.add_InvokerServicer_to_server(invoker, server)
    server.add_insecure_port(bind)
    server.start()
    LOGGER.info("rxpress bridge server listening on %s", bind)
    return BridgeApp(server=server, invoker=invoker)
