# API Documentation

`rxpress` can emit an OpenAPI 3.0 specification on demand. Enable the generator by supplying a `documentation` block when you initialise the server.

```ts
rxpress.init({
  config: {
    documentation: {
      enabled: true,
      title: 'Example API',
      version: '2.0.0',
      path: '/openapi.json',
      description: 'Public endpoints exposed by the Example service',
    },
  },
  logger,
  kv,
});
```

`rxpress` inspects your registered routes and Zod schemas to build the specification:

- **Paths** mirror the registered Express routes (e.g. `/users/{id}`)
- **Methods** follow the declared `RPCConfig.method`
- **Request bodies** are generated from `bodySchema`
- **Query parameters** come from `queryParams` (when a Zod object is supplied)
- **Responses** leverage `responseSchema` (including per-status maps)
- **Static routes** (via `staticRoute`) are rendered as `text/html` responses

Fetch the generated spec from the configured path (defaults to `/openapi.json`).

```bash
curl http://localhost:3000/openapi.json
```

Serve it via Swagger UI, ReDoc, or hand it to API client generators. The output is OpenAPI 3.0.3 compliant.

## Notes

- Cron jobs and SSE routes are omitted—they do not map cleanly to REST operations.
- Zod support covers common primitives (`string`, `number`, `boolean`, `object`, `array`, unions, enums, literals). Custom refinements fall back to generic schemas.
- Needs only the runtime metadata already declared in your route configs—no separate YAML files required.
