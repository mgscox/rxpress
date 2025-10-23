#!/usr/bin/env bash
set -euo pipefail

dirname="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$dirname/.." && pwd)"
proto_dir="$root/proto"
out_dir="$root/src/rxpress_bridge/generated"

mkdir -p "$out_dir"
python -m grpc_tools.protoc \
  --proto_path="$proto_dir" \
  --python_out="$out_dir" \
  --grpc_python_out="$out_dir" \
  handler_bridge.proto
