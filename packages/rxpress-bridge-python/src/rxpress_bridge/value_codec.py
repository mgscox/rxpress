"""Utilities mirroring rxpress encodeValue/decodeValue.

rxpress stores primitive/binary/JSON values inside the handler_bridge Value message. These helpers
allow Python handlers to work with native objects while the bridge handles the wire format.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .generated import handler_bridge_pb2 as bridge_pb


@dataclass(slots=True)
class EncodedValue:
    """Wrapper that piggybacks on the generated Value message."""

    message: bridge_pb.Value

    def to_proto(self) -> bridge_pb.Value:
        return self.message


def encode_value(value: Any) -> EncodedValue:
    msg = bridge_pb.Value()

    if value is None:
        msg.json = "null"
    elif isinstance(value, bytes):
        msg.bin = value
    elif isinstance(value, str):
        msg.s = value
    elif isinstance(value, bool):
        msg.b = value
    elif isinstance(value, int):
        msg.i64 = value
    elif isinstance(value, float):
        msg.f64 = value
    else:
        # Fallback to JSON encoding for dicts, lists, custom objects.
        import json

        try:
            msg.json = json.dumps(value)
        except (TypeError, ValueError):
            msg.json = json.dumps(str(value))

    return EncodedValue(msg)


def decode_value(message: bridge_pb.Value | None) -> Any:
    if message is None:
        return None

    which = message.WhichOneof("v")

    if which == "s":
        return message.s
    if which == "b":
        return message.b
    if which == "i64":
        return message.i64
    if which == "f64":
        return message.f64
    if which == "bin":
        return bytes(message.bin)
    if which == "json":
        import json

        try:
            return json.loads(message.json)
        except json.JSONDecodeError:
            return message.json

    return None
