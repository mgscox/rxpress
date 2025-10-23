export type CorrelationId = string;

export function createCorrelation(): CorrelationId {
  return globalThis.crypto?.randomUUID?.() ?? require('crypto').randomUUID();
}
