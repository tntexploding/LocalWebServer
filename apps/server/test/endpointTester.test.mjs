import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {EndpointTester} from '../dist/endpointTester.js';
import {MessageTemplateDecoder} from '../dist/messageTemplateDecoder.js';

test('separates HTTP client health probes from template sends', async t => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = await createTemplateRoot();
  t.after(() => rm(root, {recursive: true, force: true}));
  const config = testConfig(address.port);
  const decoder = new MessageTemplateDecoder(root);
  const tester = new EndpointTester(() => config, decoder, {
    assertHttpUrl: async () => undefined,
    assertHttpRequestSize: () => undefined,
  });

  const probe = await tester.test('httpClient', 'plugin-ic');
  assert.equal(probe.ok, true);
  assert.equal(probe.statusCode, 200);
  assert.deepEqual(requests[0], {
    method: 'GET',
    path: '/health',
    body: '',
  });

  const send = await tester.test('httpClient', 'plugin-ic', {
    mode: 'send',
    useTemplate: true,
    templateFields: [
      '$.target.id',
      '$.target.conversation_type',
      '$.content.text',
    ],
    templateValues: {
      '$.target.id': '123456',
      '$.target.conversation_type': 'qq_group',
      '$.content.text': 'hello from LAS',
    },
  });
  assert.equal(send.ok, true);
  assert.equal(send.statusCode, 200);
  assert.deepEqual(requests[1], {
    method: 'POST',
    path: '/v1/messages',
    body: JSON.stringify({
      target: {id: '123456', conversation_type: 'qq_group'},
      content: {text: 'hello from LAS'},
    }),
  });
  await assert.rejects(
    () =>
      decoder.materialize(
        'qq-send.json',
        {
          '$.target.alias': 'fallback',
          '$.content.text': 'alias must not be used',
        },
        ['$.target.alias', '$.content.text'],
      ),
    /not sendable|Required template field is missing/u,
  );

  const legacyProbe = await tester.test('httpClient', 'legacy-las-client');
  assert.equal(legacyProbe.ok, true);
  assert.deepEqual(requests[2], {
    method: 'GET',
    path: '/api/health',
    body: '',
  });
});

async function createTemplateRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'las-endpoint-test-'));
  const directory = path.join(root, 'config', 'templates');
  await mkdir(directory, {recursive: true});
  await writeFile(
    path.join(directory, 'qq-send.json'),
    `${JSON.stringify(qqSendTemplate(), null, 2)}\n`,
    'utf8',
  );
  return root;
}

function testConfig(port) {
  return {
    app: {
      server: {host: '127.0.0.1', port: 4789, webSocketPath: '/ws'},
      network: {outbound: {maxHttpResponseBytes: 1048576}},
    },
    endpoints: {
      httpServers: [],
      wsServers: [],
      httpClients: [
        {
          id: 'plugin-ic',
          enabled: true,
          baseUrl: `http://127.0.0.1:${port}`,
          headers: {},
          template: 'qq-send.json',
          templateFields: ['$.content.text'],
          templateValues: {'$.content.text': 'stored default'},
          test: {
            probePath: '/health',
            sendMethod: 'POST',
            sendPath: '/v1/messages',
          },
        },
        {
          id: 'legacy-las-client',
          enabled: true,
          baseUrl: `http://127.0.0.1:${port}`,
          headers: {},
        },
      ],
      wsClients: [],
    },
  };
}

function qqSendTemplate() {
  const sendField = (key, label, pathValue, valueType) => ({
    key,
    label,
    path: pathValue,
    description: `${label} used by the synthetic plugin_ic request.`,
    required: true,
    valueType,
    roles: {display: false, send: true, match: false},
  });
  return {
    templateVersion: '2.0',
    id: 'qq-send-test',
    name: 'QQ send test',
    description: 'Synthetic plugin_ic send contract for endpoint tests.',
    contentType: 'application/json',
    capabilities: {receive: false, send: true, match: false},
    schema: {
      type: 'object',
      required: ['target', 'content'],
      properties: {
        target: {
          type: 'object',
          required: ['id', 'conversation_type'],
          properties: {
            id: {type: 'string', minLength: 1},
            alias: {type: 'string', minLength: 1},
            conversation_type: {
              type: 'string',
              enum: ['qq_group', 'qq_private'],
            },
          },
          additionalProperties: false,
        },
        content: {
          type: 'object',
          required: ['text'],
          properties: {text: {type: 'string', minLength: 1}},
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    minimum: {body: {target: {}, content: {}}, pruneEmpty: true},
    fields: [
      sendField('target_id', 'Target ID', '$.target.id', 'string'),
      {
        ...sendField(
          'conversation_type',
          'Conversation type',
          '$.target.conversation_type',
          'string',
        ),
        allowedValues: ['qq_group', 'qq_private'],
      },
      {
        key: 'target_alias',
        label: 'Target alias',
        path: '$.target.alias',
        description: 'Legacy fallback excluded from standard direct sends.',
        required: false,
        valueType: 'string',
        roles: {display: true, send: false, match: true},
      },
      sendField('text', 'Text', '$.content.text', 'string'),
    ],
    constraints: [],
    examples: [
      {
        name: 'Group text',
        description: 'Sends a text message to one QQ group.',
        body: {
          target: {id: '123456', conversation_type: 'qq_group'},
          content: {text: 'hello'},
        },
      },
    ],
    notes: [],
  };
}
