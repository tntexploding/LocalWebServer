import {z} from 'zod';

const eventKindSchema = z.enum([
  'http.request',
  'http.response',
  'ws.message',
  'action.result',
]);

const matchConditionSchema = z.object({
  jsonPath: z.string().optional(),
  equals: z.unknown().optional(),
  contains: z.string().optional(),
  regex: z.string().optional(),
});

const matchSchema = matchConditionSchema.extend({
  all: z.array(matchConditionSchema).optional(),
});

/** Validates application runtime, security, automation, and storage settings. */
export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(4177),
    webSocketPath: z.string().default('/ws'),
  }),
  security: z.object({
    apiToken: z.string().min(1),
    allowedCommandRoots: z.array(z.string()).default([]),
    allowShell: z.boolean().default(false),
  }),
  automation: z
    .object({
      maxConcurrentActions: z.number().int().min(1).max(16).default(2),
    })
    .default({maxConcurrentActions: 2}),
  storage: z.object({
    eventLogPath: z.string().default('data/events.jsonl'),
    runLogPath: z.string().default('data/runs.jsonl'),
  }),
});

/** Validates all inbound listeners and outbound client definitions. */
export const endpointsConfigSchema = z.object({
  httpServers: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean(),
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        path: z.string().startsWith('/').default('/ingest'),
        description: z.string().optional(),
        template: z.string().min(1).optional(),
      }),
    )
    .default([]),
  wsServers: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean(),
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        path: z.string().startsWith('/'),
        description: z.string().optional(),
      }),
    )
    .default([]),
  httpClients: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean(),
        description: z.string().optional(),
        baseUrl: z.string().url(),
        headers: z.record(z.string()).optional(),
        template: z.string().min(1).optional(),
        templateFields: z.array(z.string().startsWith('$.')).optional(),
        templateValues: z.record(z.unknown()).optional(),
      }),
    )
    .default([]),
  wsClients: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean(),
        url: z.string().url(),
      }),
    )
    .default([]),
});

/** Validates declarative event matching and action-chain rules. */
export const rulesConfigSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string().min(1),
      enabled: z.boolean(),
      description: z.string().optional(),
      when: z.object({
        source: z.string().optional(),
        anySource: z.boolean().optional(),
        kind: eventKindSchema.optional(),
        match: matchSchema.optional(),
      }),
      then: z.array(
        z.object({
          action: z.string().min(1),
          with: z.record(z.unknown()).optional(),
        }),
      ),
    }),
  ),
});

const baseActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
});

const commandActionSchema = baseActionSchema.extend({
  type: z.literal('command'),
  cwd: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  allowConcurrent: z.boolean().optional(),
});

const sendHttpActionSchema = baseActionSchema.extend({
  type: z.literal('send_http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  template: z.string().min(1).optional(),
  templateValues: z.record(z.unknown()).optional(),
});

const sendWsActionSchema = baseActionSchema.extend({
  type: z.literal('send_ws'),
  target: z.string().min(1),
  body: z.unknown().optional(),
});

/** Validates executable command, HTTP, and WebSocket action definitions. */
export const actionsConfigSchema = z.object({
  actions: z.array(
    z.discriminatedUnion('type', [
      commandActionSchema,
      sendHttpActionSchema,
      sendWsActionSchema,
    ]),
  ),
});

const messageTemplateFieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  label: z.string().min(1),
  path: z.string().startsWith('$.'),
  paths: z.array(z.string().startsWith('$.')).optional(),
  description: z.string().min(1),
  required: z.boolean(),
  valueType: z.enum([
    'string',
    'number',
    'integer',
    'boolean',
    'object',
    'array',
    'null',
  ]),
  displayOrder: z.number().int().nonnegative().optional(),
  defaultValue: z.unknown().optional(),
  allowedValues: z.array(z.unknown()).min(1).optional(),
  constValue: z.unknown().optional(),
  format: z
    .enum(['date-time', 'uri', 'uuid', 'email', 'ipv4', 'ipv6'])
    .optional(),
  pattern: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
  roles: z.object({
    display: z.boolean(),
    send: z.boolean(),
    match: z.boolean(),
  }),
  input: z
    .object({
      control: z
        .enum(['text', 'textarea', 'number', 'select', 'checkbox', 'json'])
        .optional(),
      placeholder: z.string().optional(),
    })
    .optional(),
});

/** Validates a version 2 message contract and its field metadata. */
export const messageTemplateSchema = z
  .object({
    templateVersion: z.literal('2.0'),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    contentType: z.literal('application/json'),
    capabilities: z.object({
      receive: z.boolean(),
      send: z.boolean(),
      match: z.boolean(),
    }),
    schema: z.record(z.unknown()),
    minimum: z
      .object({
        body: z.unknown(),
        pruneEmpty: z.boolean(),
      })
      .superRefine((minimum, context) => {
        if (!Object.hasOwn(minimum, 'body')) {
          context.addIssue({
            code: 'custom',
            path: ['body'],
            message: 'minimum.body is required',
          });
        }
      }),
    fields: z.array(messageTemplateFieldSchema).min(1),
    constraints: z.array(
      z.object({
        kind: z.literal('atLeastOne'),
        paths: z.array(z.string().startsWith('$.')).min(1),
        message: z.string().min(1),
      }),
    ),
    examples: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().min(1),
          body: z.unknown(),
        }),
      )
      .min(1),
    notes: z.array(z.string().min(1)),
  })
  .superRefine((template, context) => {
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const [index, field] of template.fields.entries()) {
      if (keys.has(field.key)) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: `Duplicate field key: ${field.key}`,
        });
      }
      if (paths.has(field.path)) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index, 'path'],
          message: `Duplicate field path: ${field.path}`,
        });
      }
      keys.add(field.key);
      paths.add(field.path);
      if (
        field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'minimum must not exceed maximum',
        });
      }
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'minLength must not exceed maxLength',
        });
      }
      if (
        field.minItems !== undefined &&
        field.maxItems !== undefined &&
        field.minItems > field.maxItems
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'minItems must not exceed maxItems',
        });
      }
    }
  });
