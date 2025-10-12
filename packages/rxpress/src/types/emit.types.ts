import type { SpanContext } from '@opentelemetry/api';
import { RunContext } from './run.types.js';

export type Emit = (param: { topic: string; data?: unknown; run?: RunContext; traceContext?: SpanContext }) => void;
