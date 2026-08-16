import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import test from 'node:test';
import {
  allocatePort,
  baseAppConfig,
  createTestProject,
  repositoryRoot,
  testTokens,
  waitFor,
} from '../support/testProject.mjs';

test(
  'root dev command starts the backend and WebUI together',
  {timeout: 90000},
  async t => {
    const [backendPort, webPort, previewPort] = await Promise.all([
      allocatePort(),
      allocatePort(),
      allocatePort(),
    ]);
    const app = baseAppConfig(backendPort);
    app.security.corsOrigins = [`http://127.0.0.1:${webPort}`];
    const project = await createTestProject({app});
    await writeFile(
      path.join(project.root, 'config', 'web.yaml'),
      `${JSON.stringify({
        version: 1,
        host: '127.0.0.1',
        port: webPort,
        previewPort,
      })}\n`,
      'utf8',
    );

    const output = [];
    const child = spawnDevCommand(project.root);
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    t.after(async () => {
      try {
        await stopProcessTree(child);
      } finally {
        await project.dispose();
      }
    });

    const backendUrl = `http://127.0.0.1:${backendPort}/api/health`;
    const webUrl = `http://127.0.0.1:${webPort}/ui/`;
    const webOrigin = new URL(webUrl).origin;
    await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`Dev command exited early.\n${output.join('')}`);
      }
      const [backend, web] = await Promise.all([
        fetch(backendUrl).catch(() => null),
        fetch(webUrl).catch(() => null),
      ]);
      return backend?.ok && web?.ok;
    }, 30000);

    assert.match(output.join(''), /Starting backend and WebUI/u);
    assert.equal((await fetch(backendUrl)).status, 200);
    assert.equal((await fetch(webUrl)).status, 200);

    const rulesUrl = `http://127.0.0.1:${backendPort}/api/rules`;
    const preflight = await fetch(rulesUrl, {
      method: 'OPTIONS',
      headers: {
        origin: webOrigin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,x-las-token',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      webOrigin,
    );
    assert.match(
      preflight.headers.get('access-control-allow-methods') ?? '',
      /PUT/u,
    );
    assert.match(
      preflight.headers.get('access-control-allow-headers') ?? '',
      /x-las-token/iu,
    );

    const saveRules = await fetch(rulesUrl, {
      method: 'PUT',
      headers: {
        origin: webOrigin,
        'content-type': 'application/json',
        'x-las-token': testTokens.admin,
      },
      body: '[]',
    });
    assert.equal(saveRules.status, 200);
  },
);

test(
  'root dev command rejects a WebUI origin missing from the CORS allowlist',
  {timeout: 15000},
  async () => {
    const [backendPort, webPort, previewPort] = await Promise.all([
      allocatePort(),
      allocatePort(),
      allocatePort(),
    ]);
    const app = baseAppConfig(backendPort);
    app.security.corsOrigins = ['http://127.0.0.1:1'];
    const project = await createTestProject({app});
    try {
      await writeFile(
        path.join(project.root, 'config', 'web.yaml'),
        `${JSON.stringify({
          version: 1,
          host: '127.0.0.1',
          port: webPort,
          previewPort,
        })}\n`,
        'utf8',
      );
      const output = [];
      const child = spawnDevCommand(project.root);
      child.stdout.on('data', chunk => output.push(String(chunk)));
      child.stderr.on('data', chunk => output.push(String(chunk)));
      const [code] = await once(child, 'exit');
      assert.notEqual(code, 0);
      assert.match(output.join(''), /security\.corsOrigins/u);
      assert.doesNotMatch(output.join(''), /Starting backend and WebUI/u);
    } finally {
      await project.dispose();
    }
  },
);

test(
  'root dev command falls back when the configured WebUI port is unavailable',
  {timeout: 90000},
  async t => {
    const [backendPort, webPort, previewPort] = await Promise.all([
      allocatePort(),
      allocatePort(),
      allocatePort(),
    ]);
    const blocker = createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(webPort, '127.0.0.1', resolve);
    });

    const app = baseAppConfig(backendPort);
    app.security.corsOrigins = [`http://127.0.0.1:${webPort}`];
    const project = await createTestProject({app});
    await writeFile(
      path.join(project.root, 'config', 'web.yaml'),
      `${JSON.stringify({
        version: 1,
        host: '127.0.0.1',
        port: webPort,
        previewPort,
      })}\n`,
      'utf8',
    );

    const output = [];
    const child = spawnDevCommand(project.root);
    child.stdout.on('data', chunk => output.push(String(chunk)));
    child.stderr.on('data', chunk => output.push(String(chunk)));
    t.after(async () => {
      try {
        await stopProcessTree(child);
      } finally {
        await closeServer(blocker);
        await project.dispose();
      }
    });

    let fallbackPort = 0;
    await waitFor(() => {
      if (child.exitCode !== null) {
        throw new Error(`Dev command exited early.\n${output.join('')}`);
      }
      const match = output
        .join('')
        .match(/using 127\.0\.0\.1:(\d+) for this session/u);
      fallbackPort = Number(match?.[1] ?? 0);
      return fallbackPort > 0;
    }, 30000);

    assert.notEqual(fallbackPort, webPort);
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const fallbackOrigin = `http://127.0.0.1:${fallbackPort}`;
    await waitFor(async () => {
      const [backend, web] = await Promise.all([
        fetch(`${backendUrl}/api/health`).catch(() => null),
        fetch(`${fallbackOrigin}/ui/`).catch(() => null),
      ]);
      return backend?.ok && web?.ok;
    }, 30000);

    const preflight = await fetch(`${backendUrl}/api/rules`, {
      method: 'OPTIONS',
      headers: {
        origin: fallbackOrigin,
        'access-control-request-method': 'PUT',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      fallbackOrigin,
    );
    assert.match(output.join(''), /unavailable \(EADDRINUSE\)/u);
  },
);

function spawnDevCommand(projectRoot) {
  const options = {
    cwd: repositoryRoot,
    env: {...process.env, LAS_ROOT_DIR: projectRoot},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  };
  if (process.platform !== 'win32') {
    return spawn('npm', ['run', 'dev'], {...options, detached: true});
  }
  return spawn('cmd.exe', ['/d', '/s', '/c', 'npm.cmd run dev'], options);
}

async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const output = [];
    const killer = spawn(
      'taskkill.exe',
      ['/pid', String(child.pid), '/t', '/f'],
      {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true},
    );
    killer.stdout.on('data', chunk => output.push(String(chunk)));
    killer.stderr.on('data', chunk => output.push(String(chunk)));
    const [code] = await once(killer, 'exit');
    const exited = await waitForProcessExit(child, 3000);
    if (!exited && child.exitCode === null) child.kill('SIGKILL');
    assert.equal(
      code,
      0,
      `taskkill must clean up the dev process tree: ${output.join('').trim()}`,
    );
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    once(child, 'exit').then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}
