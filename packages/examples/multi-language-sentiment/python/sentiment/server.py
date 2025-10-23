"""Minimal gRPC sentiment service used by the rxpress demo.

The server avoids generated stubs by constructing the protobuf descriptors at
runtime. It exposes a single unary RPC:

    sentiment.SentimentService.Analyse

Requests contain the text to analyse (and optional language hint). Responses
contain a basic sentiment label computed via keyword heuristics.
"""

from __future__ import annotations

import logging
import os
import signal
from concurrent import futures
from threading import Event
from typing import Iterable

import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

LOGGER = logging.getLogger(__name__)


def _build_file_descriptor() -> descriptor_pb2.FileDescriptorProto:
  file_proto = descriptor_pb2.FileDescriptorProto()
  file_proto.name = "sentiment.proto"
  file_proto.package = "sentiment"
  file_proto.syntax = "proto3"

  # AnalyseRequest
  analyse_request = file_proto.message_type.add()
  analyse_request.name = "AnalyseRequest"
  field = analyse_request.field.add()
  field.name = "text"
  field.number = 1
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
  field = analyse_request.field.add()
  field.name = "language_hint"
  field.number = 2
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING

  # SentimentBreakdown
  breakdown = file_proto.message_type.add()
  breakdown.name = "SentimentBreakdown"
  field = breakdown.field.add()
  field.name = "sentence"
  field.number = 1
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
  field = breakdown.field.add()
  field.name = "score"
  field.number = 2
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE

  # AnalyseResponse
  analyse_response = file_proto.message_type.add()
  analyse_response.name = "AnalyseResponse"
  field = analyse_response.field.add()
  field.name = "detected_language"
  field.number = 1
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
  field = analyse_response.field.add()
  field.name = "polarity"
  field.number = 2
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE
  field = analyse_response.field.add()
  field.name = "confidence"
  field.number = 3
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE
  field = analyse_response.field.add()
  field.name = "breakdown"
  field.number = 4
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
  field.type_name = ".sentiment.SentimentBreakdown"
  field = analyse_response.field.add()
  field.name = "provider"
  field.number = 5
  field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
  field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING

  service = file_proto.service.add()
  service.name = "SentimentService"
  method = service.method.add()
  method.name = "Analyse"
  method.input_type = ".sentiment.AnalyseRequest"
  method.output_type = ".sentiment.AnalyseResponse"

  return file_proto


POOL = descriptor_pool.DescriptorPool()
FILE_DESCRIPTOR = POOL.Add(_build_file_descriptor())
AnalyseRequest = message_factory.GetMessageClass(POOL.FindMessageTypeByName("sentiment.AnalyseRequest"))
AnalyseResponse = message_factory.GetMessageClass(POOL.FindMessageTypeByName("sentiment.AnalyseResponse"))
SentimentBreakdown = message_factory.GetMessageClass(POOL.FindMessageTypeByName("sentiment.SentimentBreakdown"))

POSITIVE_KEYWORDS = {"great", "good", "love", "fantastic", "amazing", "happy"}
NEGATIVE_KEYWORDS = {"bad", "terrible", "hate", "awful", "sad", "angry"}


def _score(text: str) -> float:
  lowered = text.lower()
  score = 0
  for keyword in POSITIVE_KEYWORDS:
    if keyword in lowered:
      score += 1
  for keyword in NEGATIVE_KEYWORDS:
    if keyword in lowered:
      score -= 1
  if score == 0:
    return 0.0
  return max(-1.0, min(1.0, score / 3))


def _confidence(score: float) -> float:
  return min(1.0, abs(score)) if score else 0.3


def analyse(request: AnalyseRequest, _context: grpc.ServicerContext) -> AnalyseResponse:
  text = request.text or ""
  score = _score(text)
  confidence = _confidence(score)
  breakdown_entries: Iterable[SentimentBreakdown] = []
  if text:
    parts = [part.strip() for part in text.replace("!", ".").split(".") if part.strip()]
    breakdown_entries = [
      SentimentBreakdown(sentence=part, score=_score(part))
      for part in parts
    ]

  detected = request.language_hint or "und"
  response = AnalyseResponse(
    detected_language=detected,
    polarity=score,
    confidence=confidence,
    provider="python-grpc-stub",
  )
  response.breakdown.extend(breakdown_entries)
  return response


def serve(host: str, port: int) -> None:
  server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
  method_handler = grpc.unary_unary_rpc_method_handler(
    analyse,
    request_deserializer=AnalyseRequest.FromString,
    response_serializer=AnalyseResponse.SerializeToString,
  )
  service = grpc.method_handlers_generic_handler(
    "sentiment.SentimentService",
    {"Analyse": method_handler},
  )
  server.add_generic_rpc_handlers((service,))
  address = f"{host}:{port}"
  server.add_insecure_port(address)
  server.start()
  LOGGER.info("Sentiment gRPC server listening on %s", address)

  # Graceful shutdown on SIGINT/SIGTERM
  stop_event = Event()

  def _shutdown(signum: int, _frame) -> None:
    LOGGER.info("Signal %s received, shutting down", signum)
    stop_event.set()

  signal.signal(signal.SIGINT, _shutdown)
  signal.signal(signal.SIGTERM, _shutdown)

  try:
    stop_event.wait()
  finally:
    server.stop(grace=None)
    server.wait_for_termination()


def main() -> None:
  logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
  host = os.environ.get("GRPC_HOST", "127.0.0.1")
  port = int(os.environ.get("GRPC_PORT", "50055"))
  serve(host, port)


if __name__ == "__main__":
  main()
