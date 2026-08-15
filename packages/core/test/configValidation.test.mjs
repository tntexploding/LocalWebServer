import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appConfigSchema,
  assertValidConfigDependencies,
  collectConfigValidationIssues,
  endpointsConfigSchema,
} from '../dist/index.js';

test('accepts a fully connected configuration set', () => {
  assert.doesNotThrow(() =>
    assertValidConfigDependencies(validConfig(), {
      templateIds: new Set(['message.json']),
    }),
  );
});

test('reports duplicate ids, unknown references, and unreachable nodes', () => {
  const config = validConfig();
  config.endpoints.wsClients.push({
    id: 'http-client',
    enabled: true,
    url: 'ws://127.0.0.1:9000',
  });
  config.rules[0].workflow.nodes.push({
    id: 'orphan',
    type: 'end',
    label: 'Orphan',
    end: {status: 'failed'},
  });
  config.rules[0].workflow.nodes[1].action.actionId = 'missing';
  const issues = collectConfigValidationIssues(config, {
    templateIds: new Set(),
  });
  assert.ok(issues.some(issue => issue.code === 'duplicate_id'));
  assert.ok(issues.some(issue => issue.code === 'unknown_action'));
  assert.ok(issues.some(issue => issue.code === 'unknown_template'));
  assert.ok(issues.some(issue => issue.code === 'unreachable_node'));
});

test('rejects workflow expressions in executable and filesystem fields', () => {
  const config = validConfig();
  config.actions.push({
    id: 'dynamic-command',
    type: 'command',
    cwd: '${{ trigger.body.cwd }}',
    command: '${{ trigger.body.command }}',
  });

  const issues = collectConfigValidationIssues(config);
  assert.equal(
    issues.filter(issue => issue.code === 'unsafe_expression').length,
    2,
  );
});

function validConfig() {
  return {
    app: appConfigSchema.parse({
      server: {host: '127.0.0.1', port: 4789, webSocketPath: '/ws'},
      security: {
        apiToken: 'test-admin-token-000000000000000000000',
        requireTokenForRead: true,
        allowedApiSources: ['127.0.0.1', '::1'],
        corsOrigins: [],
        allowedCommandRoots: [],
        allowedExecutables: [],
        commandEnvironmentAllowlist: [],
        allowShell: false,
      },
      network: testNetworkConfig(),
      automation: {maxConcurrentActions: 2, maxActionOutputBytes: 1048576},
      storage: {
        eventLogPath: 'data/events.jsonl',
        runLogPath: 'data/runs.jsonl',
        auditLogPath: 'data/security-audit.jsonl',
        schedulerStatePath: 'data/scheduler-state.json',
        configHistoryPath: 'data/config-history',
        configHistoryLimit: 10,
        maxLogBytes: 1048576,
        maxLogFiles: 2,
      },
    }),
    endpoints: endpointsConfigSchema.parse({
      httpServers: [
        {
          id: 'inbound',
          enabled: true,
          path: '/message',
          template: 'message.json',
        },
      ],
      httpClients: [
        {
          id: 'http-client',
          enabled: true,
          baseUrl: 'http://127.0.0.1:9000',
        },
      ],
    }),
    actions: [
      {
        id: 'notify',
        type: 'notification',
        title: 'Done',
        message: 'Done',
      },
    ],
    rules: [
      {
        id: 'flow',
        enabled: true,
        workflow: {
          version: '1.0',
          startNodeId: 'trigger',
          nodes: [
            {
              id: 'trigger',
              type: 'trigger',
              label: 'Trigger',
              trigger: {
                type: 'event',
                event: {source: 'http.server.inbound'},
              },
            },
            {
              id: 'action',
              type: 'action',
              label: 'Action',
              action: {type: 'reference', actionId: 'notify'},
            },
            {
              id: 'end',
              type: 'end',
              label: 'End',
              end: {status: 'completed'},
            },
          ],
          edges: [
            {id: 'start', from: 'trigger', to: 'action', outcome: 'always'},
            {id: 'done', from: 'action', to: 'end', outcome: 'success'},
          ],
        },
      },
    ],
  };
}

function testNetworkConfig() {
  return {
    inbound: {
      allowedSources: ['127.0.0.1', '::1'],
      allowedOrigins: [],
      maxHttpBodyBytes: 1048576,
      maxWebSocketMessageBytes: 1048576,
      maxWebSocketConnectionsPerEndpoint: 16,
      requestTimeoutMs: 15000,
      headersTimeoutMs: 10000,
      keepAliveTimeoutMs: 5000,
      maxHeadersCount: 100,
    },
    outbound: {
      allowedHostnames: ['localhost'],
      allowedAddresses: ['loopback'],
      allowedPorts: [4789],
      maxHttpRequestBytes: 1048576,
      maxHttpResponseBytes: 1048576,
      maxWebSocketMessageBytes: 1048576,
    },
  };
}
