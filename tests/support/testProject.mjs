import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

export const testTokens = {
  admin: 'e2e-admin-token',
  operator: 'e2e-operator-token',
  read: 'e2e-read-token',
};

export async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export function baseAppConfig(port) {
  return {
    version: 1,
    server: {host: '127.0.0.1', port, webSocketPath: '/ws'},
    security: {
      apiToken: '${secret:apiToken}',
      operatorToken: '${secret:operatorToken}',
      readToken: '${secret:readToken}',
      requireTokenForRead: true,
      allowedApiSources: ['127.0.0.1', '::1'],
      corsOrigins: ['http://127.0.0.1:5277'],
      allowedCommandRoots: ['.'],
      allowShell: false,
    },
    automation: {maxConcurrentActions: 2},
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
  };
}

export async function createTestProject({
  app,
  endpoints = emptyEndpoints(),
  rules = {version: 1, rules: []},
  actions = {version: 1, actions: []},
  templates = {},
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'las-e2e-'));
  const configDir = path.join(root, 'config');
  const templatesDir = path.join(configDir, 'templates');
  await mkdir(templatesDir, {recursive: true});
  await Promise.all([
    writeJson(path.join(configDir, 'app.yaml'), app),
    writeJson(path.join(configDir, 'endpoints.yaml'), endpoints),
    writeJson(path.join(configDir, 'rules.yaml'), rules),
    writeJson(path.join(configDir, 'actions.yaml'), actions),
    writeJson(path.join(configDir, 'secrets.yaml'), {
      version: 1,
      secrets: {
        apiToken: testTokens.admin,
        operatorToken: testTokens.operator,
        readToken: testTokens.read,
      },
    }),
    ...Object.entries(templates).map(([name, value]) =>
      writeJson(path.join(templatesDir, name), value),
    ),
  ]);
  return {
    root,
    async dispose() {
      await rm(root, {recursive: true, force: true});
    },
  };
}

export async function startServer(projectRoot, port) {
  const output = [];
  const child = spawn(
    process.execPath,
    [path.join(repositoryRoot, 'apps', 'server', 'dist', 'index.js')],
    {
      cwd: repositoryRoot,
      env: {...process.env, LAS_ROOT_DIR: projectRoot},
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`Server exited early.\n${output.join('')}`);
      }
      const response = await fetch(`${baseUrl}/api/health`).catch(() => null);
      return response?.ok;
    }, 15000);
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    baseUrl,
    output,
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const exited = await Promise.race([
        once(child, 'exit').then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 3000)),
      ]);
      if (!exited && child.exitCode === null) {
        child.kill('SIGKILL');
        await Promise.race([
          once(child, 'exit'),
          new Promise(resolve => setTimeout(resolve, 2000)),
        ]);
      }
    },
  };
}

export async function startServerExpectFailure(projectRoot, timeoutMs = 5000) {
  const child = spawn(
    process.execPath,
    [path.join(repositoryRoot, 'apps', 'server', 'dist', 'index.js')],
    {
      cwd: repositoryRoot,
      env: {...process.env, LAS_ROOT_DIR: projectRoot},
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  const result = await Promise.race([
    once(child, 'exit').then(([code]) => ({code, timedOut: false})),
    new Promise(resolve =>
      setTimeout(() => resolve({code: null, timedOut: true}), timeoutMs),
    ),
  ]);
  if (result.timedOut && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      once(child, 'exit'),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    throw new Error(
      `Server did not reject invalid config.\n${output.join('')}`,
    );
  }
  return {code: result.code, output: output.join('')};
}

export async function apiFetch(
  baseUrl,
  requestPath,
  {token = testTokens.admin, headers = {}, ...init} = {},
) {
  return fetch(`${baseUrl}${requestPath}`, {
    ...init,
    headers: {
      ...(token ? {'x-las-token': token} : {}),
      ...headers,
    },
  });
}

export async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

export function emptyEndpoints() {
  return {
    version: 1,
    httpServers: [],
    wsServers: [],
    httpClients: [],
    wsClients: [],
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
