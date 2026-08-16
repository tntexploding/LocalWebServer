import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiSecurity,
  addressMatchesRule,
  assertValidApiSecurityPolicy,
  withDevelopmentCorsOrigin,
} from '../dist/apiSecurity.js';

const security = {
  apiToken: 'admin-token',
  operatorToken: 'operator-token',
  readToken: 'read-token',
  requireTokenForRead: true,
  allowedApiSources: ['loopback', '10.20.0.0/16'],
  corsOrigins: ['http://127.0.0.1:4177'],
  allowedCommandRoots: ['.'],
  allowShell: false,
};

test('matches exact, mapped, loopback, and CIDR source addresses', () => {
  assert.equal(addressMatchesRule('127.0.0.1', 'loopback'), true);
  assert.equal(addressMatchesRule('::1', 'loopback'), true);
  assert.equal(addressMatchesRule('::ffff:10.20.3.4', '10.20.0.0/16'), true);
  assert.equal(addressMatchesRule('10.21.3.4', '10.20.0.0/16'), false);
  assert.equal(addressMatchesRule('2001:db8::5', '2001:db8::/32'), true);
  assert.equal(addressMatchesRule('2001:dead::5', '2001:db8::/32'), false);
  assert.equal(addressMatchesRule('10.20.3.4', '10.20.0.0/99'), false);
});

test('enforces reader, operator, and administrator permissions', () => {
  const records = [];
  const policy = new ApiSecurity(() => security, {
    append: async record => void records.push(record),
  });

  assert.equal(policy.authorize(undefined, 'read').statusCode, 401);
  assert.equal(policy.authorize('read-token', 'read').allowed, true);
  assert.equal(policy.authorize('read-token', 'operate').statusCode, 403);
  assert.equal(policy.authorize('operator-token', 'operate').allowed, true);
  assert.equal(policy.authorize('operator-token', 'admin').statusCode, 403);
  assert.equal(policy.authorize('admin-token', 'admin').allowed, true);
  assert.equal(policy.authorize('wrong-token', 'read').statusCode, 401);
  assert.equal(policy.isSourceAllowed('10.20.8.9'), true);
  assert.equal(policy.isSourceAllowed('192.168.1.2'), false);
  assert.equal(policy.isOriginAllowed(undefined), true);
  assert.equal(policy.isOriginAllowed('http://127.0.0.1:4177'), true);
  assert.equal(policy.isOriginAllowed('https://example.test'), false);
});

test('adds only an exact loopback development origin without mutating config', () => {
  const effective = withDevelopmentCorsOrigin(
    security,
    'http://127.0.0.1:49152',
  );
  assert.notEqual(effective, security);
  assert.deepEqual(security.corsOrigins, ['http://127.0.0.1:4177']);
  assert.equal(effective.corsOrigins.includes('http://127.0.0.1:49152'), true);
  assert.throws(
    () => withDevelopmentCorsOrigin(security, 'https://example.test'),
    /exact loopback HTTP origin/u,
  );
  assert.throws(
    () => withDevelopmentCorsOrigin(security, 'http://127.0.0.1:49152/path'),
    /exact loopback HTTP origin/u,
  );
});

test('writes security audit metadata without request content', async () => {
  const records = [];
  const policy = new ApiSecurity(() => security, {
    append: async record => void records.push(record),
  });
  await policy.audit({
    requestId: 'request-1',
    remoteAddress: '127.0.0.1',
    method: 'POST',
    path: '/api/actions/example/run',
    permission: 'operate',
    outcome: 'denied',
    statusCode: 403,
    role: 'reader',
    reason: 'insufficient role',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].path, '/api/actions/example/run');
  assert.equal('body' in records[0], false);
  assert.equal('token' in records[0], false);
});

test('rejects wildcard control sources and non-origin browser URLs', () => {
  assert.throws(
    () =>
      assertValidApiSecurityPolicy({
        ...security,
        allowedApiSources: ['*'],
      }),
    /Invalid control API source rule/u,
  );
  assert.throws(
    () =>
      assertValidApiSecurityPolicy({
        ...security,
        corsOrigins: ['https://example.test/path'],
      }),
    /Invalid control API browser origin/u,
  );
});
