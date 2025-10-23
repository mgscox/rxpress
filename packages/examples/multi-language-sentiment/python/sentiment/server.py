"""Sentiment gRPC bridge example using rxpress-bridge."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Dict

try:
    from rxpress_bridge import BridgeContext, serve
except ModuleNotFoundError:  # pragma: no cover
    import sys

    repo_root = Path(__file__).resolve().parents[3]
    sys.path.append(str(repo_root / 'rxpress-bridge-python' / 'src'))
    from rxpress_bridge import BridgeContext, serve  # type: ignore

LOGGER = logging.getLogger(__name__)

POSITIVE = {"great", "good", "love", "fantastic", "amazing", "happy"}
NEGATIVE = {"bad", "terrible", "hate", "awful", "sad", "angry"}


def _score(text: str) -> float:
    lowered = text.lower()
    score = 0
    for token in POSITIVE:
        if token in lowered:
            score += 1
    for token in NEGATIVE:
        if token in lowered:
            score -= 1
    if score == 0:
        return 0.0
    return max(-1.0, min(1.0, score / 3))


def _confidence(score: float) -> float:
    return min(1.0, abs(score)) if score else 0.3


def _breakdown(text: str) -> list[dict[str, Any]]:
    parts = [segment.strip() for segment in text.replace("!", ".").split(".") if segment.strip()]
    return [{"sentence": part, "score": _score(part)} for part in parts]


def _normalise_language(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def analyse(_: str, payload: Dict[str, Any], meta: Dict[str, Any], ctx: BridgeContext) -> Dict[str, Any]:
    body = payload.get('body') or {}
    text = str(body.get('text', ''))
    language_hint = _normalise_language(body.get('language'))

    score = _score(text)
    confidence = _confidence(score)
    breakdown = _breakdown(text)

    ctx.log('info', 'sentiment analysed', {
        'score': score,
        'confidence': confidence,
        'length': len(text),
        'traceId': meta.get('trace_id'),
    })

    return {
        'status': 200,
        'body': {
            'text': text,
            'language': language_hint,
            'polarity': score,
            'confidence': confidence,
            'breakdown': breakdown,
            'provider': 'python-bridge-stub',
        },
    }


def run() -> None:
    logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

    bind = os.environ.get('BRIDGE_BIND', '127.0.0.1:50055')
    control_target = os.environ.get('CONTROL_TARGET', '127.0.0.1:50070')

    app = serve(bind=bind, handlers={'sentiment.analyse': analyse}, control_target=control_target)
    LOGGER.info('Sentiment bridge listening on %s (control target %s)', bind, control_target)

    try:
        app.wait_forever()
    except KeyboardInterrupt:  # pragma: no cover
        LOGGER.info('Stopping bridge...')
        app.stop(grace=1.0)


if __name__ == '__main__':
    run()
