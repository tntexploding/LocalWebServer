import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidNetworkPolicy,
  NetworkPolicy,
  readLimitedResponseText,
  safeNetworkTarget,
} from '../dist/networkPolicy.js';

test('enforces inbound source and browser-origin allowlists', () => {
  const policy = new NetworkPolicy(() => networkConfig());
  assert.equal(policy.isInboundSourceAllowed('127.0.0.1'), true);
  assert.equal(policy.isInboundSourceAllowed('192.168.1.10'), false);
  assert.equal(policy.isInboundOriginAllowed(undefined), true);
  assert.equal(policy.isInboundOriginAllowed('http://trusted.local'), true);
  assert.equal(
    policy.isInboundOriginAllowed('https://attacker.example'),
    false,
  );
});

test('allows only configured outbound addresses and ports', async () => {
  const policy = new NetworkPolicy(() => networkConfig());
  await policy.assertHttpUrl('http://127.0.0.1:4789/path');
  await policy.assertWebSocketUrl('ws://[::1]:4789/ws');
  await assert.rejects(
    policy.assertHttpUrl('http://127.0.0.1:4790/path'),
    /port is not allowlisted/u,
  );
  await assert.rejects(
    policy.assertHttpUrl('http://169.254.169.254:4789/latest/meta-data'),
    /address is not allowlisted/u,
  );
  const credentialUrl = new URL('http://127.0.0.1:4789/path');
  credentialUrl.username = 'user';
  credentialUrl.password = 'password';
  await assert.rejects(
    policy.assertHttpUrl(credentialUrl.toString()),
    /embedded credentials/u,
  );
});

test('rejects a public hostname that resolves into a restricted network', async () => {
  const policy = new NetworkPolicy(
    () => ({
      ...networkConfig(),
      outbound: {
        ...networkConfig().outbound,
        allowedHostnames: ['service.example'],
      },
    }),
    async () => [{address: '127.0.0.1', family: 4}],
  );
  await assert.rejects(
    policy.assertHttpUrl('https://service.example:4789/path'),
    /restricted address/u,
  );
});

test('allows a private hostname only inside its scoped address rules', async () => {
  let resolutions = 0;
  const policy = new NetworkPolicy(
    () => ({
      ...networkConfig(),
      outbound: {
        ...networkConfig().outbound,
        allowedPrivateHostnames: [
          {
            hostname: 'host.docker.internal',
            allowedAddresses: ['172.16.0.0/12'],
          },
        ],
      },
    }),
    async () => {
      resolutions += 1;
      return [{address: '172.17.0.1', family: 4}];
    },
  );

  await policy.assertConfiguredHttpUrl('http://host.docker.internal:4789/path');
  assert.equal(resolutions, 0);
  await policy.assertHttpUrl('http://host.docker.internal:4789/path');
  assert.equal(resolutions, 1);
});

test('rejects any private hostname address outside its scoped rules', async () => {
  const policy = new NetworkPolicy(
    () => ({
      ...networkConfig(),
      outbound: {
        ...networkConfig().outbound,
        allowedPrivateHostnames: [
          {
            hostname: 'private-service',
            allowedAddresses: ['172.16.0.0/12'],
          },
        ],
      },
    }),
    async () => [
      {address: '172.17.0.8', family: 4},
      {address: '203.0.113.8', family: 4},
    ],
  );

  await assert.rejects(
    policy.assertHttpUrl('http://private-service:4789/path'),
    /outside its address allowlist/u,
  );
});

test('validates configured hostnames without requiring DNS connectivity', async () => {
  let resolutions = 0;
  const policy = new NetworkPolicy(
    () => ({
      ...networkConfig(),
      outbound: {
        ...networkConfig().outbound,
        allowedHostnames: ['offline.example'],
      },
    }),
    async () => {
      resolutions += 1;
      throw new Error('DNS is offline.');
    },
  );

  await policy.assertConfiguredHttpUrl('https://offline.example:4789/path');
  assert.equal(resolutions, 0);
  await assert.rejects(
    policy.assertHttpUrl('https://offline.example:4789/path'),
    /DNS is offline/u,
  );
  assert.equal(resolutions, 1);
});

test('limits payloads and removes query values from logs', async () => {
  const policy = new NetworkPolicy(() => networkConfig());
  assert.throws(
    () => policy.assertHttpRequestSize('123456789'),
    /limit is 8 bytes/u,
  );
  await assert.rejects(
    readLimitedResponseText(new Response('123456789'), 8),
    /exceeds the 8 byte limit/u,
  );
  const loggedUrl = new URL('https://example.com/path?token=secret#part');
  loggedUrl.username = 'user';
  loggedUrl.password = 'password';
  assert.equal(
    safeNetworkTarget(loggedUrl.toString()),
    'https://example.com/path?[REDACTED]',
  );
});

test('rejects malformed network policy entries', () => {
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedHostnames: ['*.example.com'],
        },
      }),
    /exact lowercase DNS name/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        inbound: {
          ...networkConfig().inbound,
          allowedSources: ['not-an-address'],
        },
      }),
    /Invalid network address rule/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedHostnames: ['invalid%host'],
        },
      }),
    /Invalid outbound hostname/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedPrivateHostnames: [
            {
              hostname: 'private-service',
              allowedAddresses: ['not-an-address'],
            },
          ],
        },
      }),
    /Invalid network address rule/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedHostnames: ['private-service'],
          allowedPrivateHostnames: [
            {
              hostname: 'private-service',
              allowedAddresses: ['172.16.0.0/12'],
            },
          ],
        },
      }),
    /public and private policies together/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedPrivateHostnames: [
            {hostname: 'private-service', allowedAddresses: []},
          ],
        },
      }),
    /requires at least one address rule/u,
  );
  assert.throws(
    () =>
      assertValidNetworkPolicy({
        ...networkConfig(),
        outbound: {
          ...networkConfig().outbound,
          allowedPrivateHostnames: [
            {
              hostname: 'private-service',
              allowedAddresses: ['172.16.0.0/12'],
            },
            {
              hostname: 'private-service',
              allowedAddresses: ['192.168.0.0/16'],
            },
          ],
        },
      }),
    /Duplicate private outbound hostname policy/u,
  );
});

function networkConfig() {
  return {
    inbound: {
      allowedSources: ['loopback'],
      allowedOrigins: ['http://trusted.local'],
      maxHttpBodyBytes: 8,
      maxWebSocketMessageBytes: 8,
      maxWebSocketConnectionsPerEndpoint: 2,
      requestTimeoutMs: 2000,
      headersTimeoutMs: 1000,
      keepAliveTimeoutMs: 1000,
      maxHeadersCount: 20,
    },
    outbound: {
      allowedHostnames: ['localhost'],
      allowedPrivateHostnames: [],
      allowedAddresses: ['loopback'],
      allowedPorts: [4789],
      maxHttpRequestBytes: 8,
      maxHttpResponseBytes: 8,
      maxWebSocketMessageBytes: 8,
    },
  };
}
