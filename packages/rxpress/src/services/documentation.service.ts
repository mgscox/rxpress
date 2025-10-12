import express from 'express';
import { z, ZodTypeAny } from 'zod';

import type { DocumentationConfig } from '../types/documentation.types.js';
import type { RPCConfig } from '../types/rpc.types.js';

type NormalizedDocumentationOptions = {
  enabled: boolean;
  title: string;
  version: string;
  description?: string;
  path: string;
};

const DEFAULT_OPTIONS: NormalizedDocumentationOptions = {
  enabled: false,
  title: 'rxpress API',
  version: '1.0.0',
  description: undefined,
  path: '/openapi.json',
};

const paths: Record<string, Record<string, unknown>> = {};
let options: NormalizedDocumentationOptions = { ...DEFAULT_OPTIONS };
let attached = false;

function normalizePath(path?: string): string {
  if (!path) {
    return '/openapi.json';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

function convertExpressPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

function clone<Value>(value: Value): Value {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as Value;
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  const def = (schema as any)._def ?? {};

  if (def.innerType) {
    return unwrap(def.innerType as ZodTypeAny);
  }

  if (def.schema) {
    return unwrap(def.schema as ZodTypeAny);
  }

  if (def.type) {
    return unwrap(def.type as ZodTypeAny);
  }

  return schema;
}

function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const unwrapped = unwrap(schema);

  if (unwrapped instanceof z.ZodString) {
    return { type: 'string' };
  }

  if (unwrapped instanceof z.ZodNumber) {
    const def = (unwrapped as any)._def ?? {};
    const checks = def.checks ?? [];
    const isInt = checks.some((check: any) => check.kind === 'int');
    return { type: isInt ? 'integer' : 'number' };
  }

  if (unwrapped instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }

  if (unwrapped instanceof z.ZodBigInt) {
    return { type: 'integer', format: 'int64' };
  }

  if (unwrapped instanceof z.ZodDate) {
    return { type: 'string', format: 'date-time' };
  }

  if (unwrapped instanceof z.ZodArray) {
    const def = (unwrapped as any)._def ?? {};
    return {
      type: 'array',
      items: zodToJsonSchema((def.type as ZodTypeAny) ?? unwrapped.element),
    };
  }

  if (unwrapped instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = (unwrapped as any).shape ?? {};

    for (const [key, value] of Object.entries(shape)) {
      const optional = typeof (value as any).isOptional === 'function' && (value as any).isOptional();

      if (!optional) {
        required.push(key);
      }

      properties[key] = zodToJsonSchema(value as ZodTypeAny);
    }

    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    };
  }

  if (unwrapped instanceof z.ZodLiteral) {
    const literalValue = (unwrapped as any)._def.value;
    return { const: literalValue, type: typeof literalValue };
  }

  if (unwrapped instanceof z.ZodEnum) {
    return { type: 'string', enum: (unwrapped as any).options };
  }

  if (unwrapped instanceof z.ZodUnion) {
    const optionsList = ((unwrapped as any)._def?.options ?? []) as ZodTypeAny[];
    return { oneOf: optionsList.map((option) => zodToJsonSchema(option)) };
  }

  if (unwrapped instanceof z.ZodNull) {
    return { type: 'null' };
  }

  if (unwrapped instanceof z.ZodUnknown || unwrapped instanceof z.ZodAny) {
    return {};
  }

  return {};
}

function buildParameters(route: RPCConfig): unknown[] {
  if (!route.queryParams) {
    return [];
  }

  const schema = unwrap(route.queryParams);

  if (!(schema instanceof z.ZodObject)) {
    return [];
  }

  const parameters: unknown[] = [];

  const shape = (schema as any).shape ?? {};

  for (const [key, value] of Object.entries(shape)) {
    const optional = typeof (value as any).isOptional === 'function' && (value as any).isOptional();
    parameters.push({
      name: key,
      in: 'query',
      required: !optional,
      schema: zodToJsonSchema(value as ZodTypeAny),
    });
  }

  return parameters;
}

function buildRequestBody(route: RPCConfig): Record<string, unknown> | undefined {
  if (!route.bodySchema) {
    return undefined;
  }

  const schema = zodToJsonSchema(route.bodySchema);

  return {
    required: true,
    content: {
      'application/json': {
        schema,
      },
    },
  };
}

function buildResponses(route: RPCConfig): Record<string, unknown> {
  const responses: Record<string, unknown> = {};

  const attachResponse = (status: string, contentType: string, schema: Record<string, unknown>) => {
    responses[status] = {
      description: route.description || 'Description not provided in route configuration',
      content: {
        [contentType]: { schema },
      },
    };
  };

  if ('staticRoute' in route) {
    attachResponse('200', 'text/html', { type: 'string' });
    responses['404'] = { description: 'Resource not found' };
    return responses;
  }

  if (route.responseSchema instanceof z.ZodObject) {
    attachResponse('200', 'application/json', zodToJsonSchema(route.responseSchema));
    return responses;
  }

  if (route.responseSchema && typeof route.responseSchema === 'object') {
    for (const [status, schema] of Object.entries(route.responseSchema)) {
      if (schema instanceof z.ZodObject) {
        attachResponse(status, 'application/json', zodToJsonSchema(schema));
      }
    }

    if (!Object.keys(responses).length) {
      responses['200'] = { description: 'Success' };
    }

    return responses;
  }

  if (route.type === 'api') {
    responses['200'] = { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } };
  }
  else {
    responses['200'] = { description: 'Success', content: { 'text/plain': { schema: { type: 'string' } } } };
  }

  return responses;
}

function buildOperation(route: RPCConfig): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    summary: route.description,
    tags: route.flow ? [route.flow] : undefined,
    parameters: buildParameters(route),
    requestBody: buildRequestBody(route),
    responses: buildResponses(route),
  };

  if (!operation.requestBody) {
    delete operation.requestBody;
  }

  if (!operation.parameters || (operation.parameters as unknown[]).length === 0) {
    delete operation.parameters;
  }

  if (!operation.tags) {
    delete operation.tags;
  }

  if (!operation.summary) {
    delete operation.summary;
  }

  return operation;
}

export namespace DocumentationService {
  export function configure(config?: DocumentationConfig): void {
    const merged: NormalizedDocumentationOptions = {
      ...DEFAULT_OPTIONS,
      ...(config ?? {}),
      enabled: config?.enabled ?? DEFAULT_OPTIONS.enabled,
      path: normalizePath(config?.path),
      title: config?.title ?? DEFAULT_OPTIONS.title,
      version: config?.version ?? DEFAULT_OPTIONS.version,
      description: config?.description ?? DEFAULT_OPTIONS.description,
    };
    options = merged;
  }

  export function attach(app: express.Express): void {
    if (!options.enabled || attached) {
      return;
    }

    app.get(options.path, (_req, res) => {
      res.json(getSpec());
    });
    attached = true;
  }

  export function registerRoute(route: RPCConfig): void {
    if (!options.enabled) {
      return;
    }

    if (route.type === 'sse') {
      return;
    }

    const path = convertExpressPath(route.path);
    const method = route.method.toLowerCase();
    paths[path] = paths[path] || {};
    paths[path][method] = buildOperation(route);
  }

  export function getSpec(): Record<string, unknown> {
    return {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: options.description,
      },
      paths: clone(paths),
    };
  }

  export function reset(): void {
    for (const key of Object.keys(paths)) {
      delete paths[key];
    }

    attached = false;
    options = { ...DEFAULT_OPTIONS };
  }
}
