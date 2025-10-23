import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / 'src'))

from rxpress_bridge.generated import handler_bridge_pb2 as hb  # noqa: F401
from rxpress_bridge.generated import handler_bridge_pb2_grpc as hb_grpc  # noqa: F401

def test_generated_imports():
    assert hb.DESCRIPTOR is not None
    assert hb_grpc.InvokerStub is not None
