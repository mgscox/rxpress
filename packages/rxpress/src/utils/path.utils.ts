const { isArray } = Array;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value);
}

export function splitPath(path: string): string[] {
  return path.split('.').map((segment) => segment.trim()).filter(Boolean);
}

export function getFromObject<T = unknown>(target: unknown, segments: string[]): T | undefined {
  if (segments.length === 0) {
    return target as T;
  }

  let current: unknown = target;

  for (const segment of segments) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[segment as keyof typeof current];
  }

  return current as T | undefined;
}

export function setInObject(target: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];

    if (!isPlainObject(next)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value as never;
}

export function deleteInObject(target: Record<string, unknown>, segments: string[]): void {
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> | undefined = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current?.[segment];

    if (!isPlainObject(next)) {
      return;
    }

    current = next as Record<string, unknown>;
  }

  if (current) {
    delete current[segments[segments.length - 1]];
  }
}

export function hasInObject(target: unknown, segments: string[]): boolean {
  if (segments.length === 0) {
    return true;
  }

  let current: unknown = target;

  for (const segment of segments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return false;
    }

    current = current[segment as keyof typeof current];
  }

  return true;
}
