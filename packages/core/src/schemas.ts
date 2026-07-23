import {z} from 'zod';
import {
  containsWorkflowExpression,
  validateWorkflowExpressionSyntax,
} from './expressions.js';

const expressionMissingPolicySchema = z.enum(['error', 'empty', 'preserve']);
const misfirePolicySchema = z.enum(['skip', 'runOnce']).default('skip');

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(8).default(1),
  initialDelayMs: z.number().int().min(0).max(300000).default(500),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  maxDelayMs: z.number().int().min(0).max(600000).default(30000),
});

const dynamicUrlSchema = z
  .string()
  .min(1)
  .refine(
    value =>
      containsWorkflowExpression(value) ||
      z.string().url().safeParse(value).success,
    {message: 'Invalid URL or workflow expression'},
  );

const eventKindSchema = z.enum([
  'http.request',
  'http.response',
  'ws.message',
  'action.result',
  'timer.trigger',
]);

const matchConditionSchema = z.object({
  jsonPath: z.string().optional(),
  equals: z.unknown().optional(),
  contains: z.string().optional(),
  regex: z
    .string()
    .refine(isValidRegex, {message: 'Invalid regular expression'})
    .optional(),
});

const matchSchema = matchConditionSchema.extend({
  all: z.array(matchConditionSchema).optional(),
});

const workflowEventFilterSchema = z.object({
  source: z.string().min(1).optional(),
  anySource: z.boolean().optional(),
  kind: eventKindSchema.optional(),
  template: z.string().min(1).optional(),
  match: matchSchema.optional(),
});

const workflowScheduleSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('once'),
    at: z.string().refine(isValidDate, {message: 'Invalid scheduled date'}),
    misfirePolicy: misfirePolicySchema.optional(),
  }),
  z.object({
    mode: z.literal('interval'),
    everyMs: z.number().int().min(1000),
    startAt: z
      .string()
      .refine(isValidDate, {message: 'Invalid interval start date'})
      .optional(),
    misfirePolicy: misfirePolicySchema.optional(),
  }),
  z.object({
    mode: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
    timeZone: z
      .string()
      .refine(isValidTimeZone, {message: 'Invalid IANA time zone'})
      .optional(),
    misfirePolicy: misfirePolicySchema.optional(),
  }),
]);

const workflowTriggerSchema = z.union([
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('event'),
      event: workflowEventFilterSchema,
    }),
    z.object({
      type: z.literal('time'),
      schedule: workflowScheduleSchema,
    }),
  ]),
  workflowEventFilterSchema.transform(event => ({
    type: 'event' as const,
    event,
  })),
]);

const workflowActionSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('reference'),
      actionId: z.string().min(1),
      with: z.record(z.unknown()).optional(),
      onMissing: expressionMissingPolicySchema.optional(),
    }),
    z.object({
      type: z.literal('command'),
      cwd: z.string().min(1),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      allowConcurrent: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('script'),
      cwd: z.string().min(1),
      interpreter: z.string().min(1),
      script: z.string().min(1),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal('notification'),
      title: z.string().min(1),
      message: z.string(),
    }),
    z.object({
      type: z.literal('prompt'),
      title: z.string().min(1),
      message: z.string(),
      options: z.array(z.string().min(1)).min(1),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal('send_http'),
      clientId: z.string().min(1).optional(),
      url: z.string().url().optional(),
      path: z.string().startsWith('/').optional(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      headers: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      template: z.string().min(1).optional(),
      templateValues: z.record(z.unknown()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      retry: retryPolicySchema.optional(),
      idempotencyKey: z.string().min(1).optional(),
      expressionPolicy: expressionMissingPolicySchema.optional(),
    }),
    z.object({
      type: z.literal('send_ws'),
      target: z.string().min(1),
      body: z.unknown().optional(),
      timeoutMs: z.number().int().positive().optional(),
      retry: retryPolicySchema.optional(),
    }),
    workflowEventFilterSchema.extend({
      type: z.literal('wait_event'),
      timeoutMs: z.number().int().positive().optional(),
    }),
  ])
  .superRefine((action, context) => {
    if (action.type === 'send_http' && !action.clientId && !action.url) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'send_http requires clientId or url',
      });
    }
    addExpressionIssues(action, context);
  });

const workflowNodeBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  position: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .optional(),
});

const workflowNodeSchema = z.discriminatedUnion('type', [
  workflowNodeBaseSchema.extend({
    type: z.literal('trigger'),
    trigger: workflowTriggerSchema,
  }),
  workflowNodeBaseSchema.extend({
    type: z.literal('action'),
    action: workflowActionSchema,
  }),
  workflowNodeBaseSchema.extend({
    type: z.literal('logic'),
    logic: z.object({
      input: z.enum(['lastResult', 'triggerEvent', 'lastEvent']),
      jsonPath: z.string().startsWith('$.').optional(),
      operator: z.enum(['equals', 'contains', 'regex', 'truthy', 'success']),
      value: z.unknown().optional(),
    }),
  }),
  workflowNodeBaseSchema.extend({
    type: z.literal('end'),
    end: z.object({
      status: z.enum(['completed', 'failed']),
      message: z.string().optional(),
    }),
  }),
]);

const workflowGraphSchema = z
  .object({
    version: z.literal('1.0'),
    startNodeId: z.string().min(1),
    nodes: z.array(workflowNodeSchema).min(2),
    edges: z.array(
      z.object({
        id: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        outcome: z
          .enum(['always', 'success', 'failure', 'true', 'false'])
          .default('always'),
        label: z.string().optional(),
      }),
    ),
  })
  .superRefine((workflow, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of workflow.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: `Duplicate workflow node id: ${node.id}`,
        });
      }
      nodeIds.add(node.id);
      if (
        node.type === 'logic' &&
        node.logic.operator === 'regex' &&
        (typeof node.logic.value !== 'string' ||
          !isValidRegex(node.logic.value))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'logic', 'value'],
          message: 'Regex logic requires a valid string pattern',
        });
      }
    }
    const start = workflow.nodes.find(node => node.id === workflow.startNodeId);
    if (!start || start.type !== 'trigger') {
      context.addIssue({
        code: 'custom',
        path: ['startNodeId'],
        message: 'startNodeId must reference a trigger node',
      });
    }
    if (!workflow.nodes.some(node => node.type === 'end')) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'workflow requires at least one end node',
      });
    }
    const edgeIds = new Set<string>();
    for (const [index, edge] of workflow.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'id'],
          message: `Duplicate workflow edge id: ${edge.id}`,
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: 'workflow edge references an unknown node',
        });
      }
      if (edge.from === edge.to) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: 'workflow edge cannot connect a node to itself',
        });
      }
      const source = workflow.nodes.find(node => node.id === edge.from);
      const validOutcome =
        source?.type === 'trigger'
          ? edge.outcome === 'always'
          : source?.type === 'action'
            ? ['always', 'success', 'failure'].includes(edge.outcome)
            : source?.type === 'logic'
              ? ['always', 'true', 'false'].includes(edge.outcome)
              : false;
      if (source && !validOutcome) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'outcome'],
          message: `Outcome "${edge.outcome}" is invalid for ${source.type} node "${source.id}"`,
        });
      }
    }
    for (const [index, node] of workflow.nodes.entries()) {
      if (
        node.type !== 'end' &&
        !workflow.edges.some(edge => edge.from === node.id)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index],
          message: `Workflow node "${node.id}" requires an outgoing edge`,
        });
      }
    }
  });

function isValidRegex(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function isValidDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value});
    return true;
  } catch {
    return false;
  }
}

function addExpressionIssues(value: unknown, context: z.RefinementCtx): void {
  for (const message of validateWorkflowExpressionSyntax(value)) {
    context.addIssue({code: 'custom', message});
  }
}

/** Validates application runtime, security, automation, and storage settings. */
export const appConfigSchema = z.object({
  version: z.literal(1).default(1),
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    webSocketPath: z.string().startsWith('/'),
  }),
  security: z.object({
    apiToken: z.string().min(1),
    operatorToken: z.string().min(1).optional(),
    readToken: z.string().min(1).optional(),
    requireTokenForRead: z.boolean(),
    allowedApiSources: z.array(z.string().min(1)).min(1),
    corsOrigins: z.array(z.string().min(1)),
    allowedCommandRoots: z.array(z.string()),
    allowShell: z.boolean(),
  }),
  automation: z.object({
    maxConcurrentActions: z.number().int().min(1).max(16),
  }),
  storage: z.object({
    eventLogPath: z.string().min(1),
    runLogPath: z.string().min(1),
    auditLogPath: z.string().min(1),
    schedulerStatePath: z.string().min(1),
    configHistoryPath: z.string().min(1),
    configHistoryLimit: z.number().int().min(1).max(200),
    maxLogBytes: z.number().int().min(65536),
    maxLogFiles: z.number().int().min(1).max(20),
  }),
});

/** Validates all inbound listeners and outbound client definitions. */
export const endpointsConfigSchema = z.object({
  version: z.literal(1).default(1),
  httpServers: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean(),
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        path: z.string().startsWith('/'),
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
        description: z.string().optional(),
        reconnect: z
          .object({
            enabled: z.boolean().default(true),
            initialDelayMs: z.number().int().min(100).max(300000).default(1000),
            maxDelayMs: z.number().int().min(100).max(600000).default(30000),
            backoffMultiplier: z.number().min(1).max(10).default(2),
          })
          .optional(),
        heartbeatIntervalMs: z.number().int().min(1000).max(300000).optional(),
      }),
    )
    .default([]),
});

/** Validates declarative event matching and action-chain rules. */
export const rulesConfigSchema = z.object({
  version: z.literal(1).default(1),
  rules: z.array(
    z
      .object({
        id: z.string().min(1),
        enabled: z.boolean(),
        description: z.string().optional(),
        when: workflowEventFilterSchema.omit({template: true}).optional(),
        then: z
          .array(
            z.object({
              action: z.string().min(1),
              with: z.record(z.unknown()).optional(),
            }),
          )
          .optional(),
        workflow: workflowGraphSchema.optional(),
      })
      .superRefine((rule, context) => {
        const hasLegacy = rule.when !== undefined && rule.then !== undefined;
        if (!hasLegacy && !rule.workflow) {
          context.addIssue({
            code: 'custom',
            path: ['workflow'],
            message: 'rule requires when/then or workflow',
          });
        }
      }),
  ),
});

const baseActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  expressionPolicy: expressionMissingPolicySchema.optional(),
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
  url: dynamicUrlSchema,
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  template: z.string().min(1).optional(),
  templateValues: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: retryPolicySchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const sendWsActionSchema = baseActionSchema.extend({
  type: z.literal('send_ws'),
  target: z.string().min(1),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: retryPolicySchema.optional(),
});

const scriptActionSchema = baseActionSchema.extend({
  type: z.literal('script'),
  cwd: z.string().min(1),
  interpreter: z.string().min(1),
  script: z.string().min(1),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const notificationActionSchema = baseActionSchema.extend({
  type: z.literal('notification'),
  title: z.string().min(1),
  message: z.string(),
});

const promptActionSchema = baseActionSchema.extend({
  type: z.literal('prompt'),
  title: z.string().min(1),
  message: z.string(),
  options: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().positive().optional(),
});

const waitEventActionSchema = baseActionSchema.merge(
  workflowEventFilterSchema.extend({
    type: z.literal('wait_event'),
    timeoutMs: z.number().int().positive().optional(),
  }),
);

/** Validates one reusable action definition. */
export const actionConfigSchema = z
  .discriminatedUnion('type', [
    commandActionSchema,
    sendHttpActionSchema,
    sendWsActionSchema,
    scriptActionSchema,
    notificationActionSchema,
    promptActionSchema,
    waitEventActionSchema,
  ])
  .superRefine(addExpressionIssues);

/** Validates all reusable action definitions. */
export const actionsConfigSchema = z.object({
  version: z.literal(1).default(1),
  actions: z.array(actionConfigSchema),
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
  generatedValue: z.enum(['uuid', 'utc-date-time']).optional(),
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
      if (
        field.generatedValue !== undefined &&
        field.defaultValue !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'generatedValue and defaultValue cannot be used together',
        });
      }
      if (
        field.generatedValue !== undefined &&
        field.constValue !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'generatedValue and constValue cannot be used together',
        });
      }
      if (
        field.generatedValue === 'uuid' &&
        (field.valueType !== 'string' ||
          (field.format !== undefined && field.format !== 'uuid'))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index, 'generatedValue'],
          message: 'uuid generation requires a string field with uuid format',
        });
      }
      if (
        field.generatedValue === 'utc-date-time' &&
        (field.valueType !== 'string' ||
          (field.format !== undefined && field.format !== 'date-time'))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index, 'generatedValue'],
          message:
            'utc-date-time generation requires a string field with date-time format',
        });
      }
    }
  });
