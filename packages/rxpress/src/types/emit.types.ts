import { RunContext } from './run.types.js';

export type Emit = (param: { topic: string; data?: unknown; run?: RunContext }) => void;
