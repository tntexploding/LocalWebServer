import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDevelopmentSettings} from './development-settings.mjs';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const serverRoot = path.join(codeRoot, 'apps', 'server');
const webRoot = path.join(codeRoot, 'apps', 'web');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Map();
let shuttingDown = false;
let shutdownPromise;

async function main() {
  const settings = await loadDevelopmentSettings(projectRoot);
  await assertPortAvailable(
    settings.backendHost,
    settings.backendPort,
    'backend',
  );
  await assertPortAvailable(settings.webHost, settings.webPort, 'WebUI');

  await runBuild('build:core', ['run', 'build', '-w', '@las/core']);
  await runBuild('build:storage', ['run', 'build', '-w', '@las/storage']);

  const server = startNodeProcess(
    'server',
    resolvePackageCli(serverRoot, 'tsx'),
    ['watch', 'src/index.ts'],
    {cwd: serverRoot, env: process.env},
  );
  await waitForHttp(`${settings.apiBase}/api/health`, 'backend', server);

  const web = startNodeProcess(
    'web',
    resolvePackageCli(webRoot, 'vite'),
    [
      '--host',
      settings.webHost,
      '--port',
      String(settings.webPort),
      '--strictPort',
    ],
    {
      cwd: webRoot,
      env: {...process.env, VITE_API_BASE: settings.apiBase},
    },
  );
  await waitForHttp(settings.webUrl, 'WebUI', web);

  console.log(`[dev] Backend ready: ${settings.apiBase}`);
  console.log(`[dev] WebUI ready:   ${settings.webUrl}`);
  console.log('[dev] Press Ctrl+C to stop both processes.');
}

function resolvePackageCli(packageRoot, packageName) {
  const requireFromPackage = createRequire(
    path.join(packageRoot, 'package.json'),
  );
  const packagePath = requireFromPackage.resolve(`${packageName}/package.json`);
  const packageConfig = requireFromPackage(packagePath);
  const relativeCli =
    typeof packageConfig.bin === 'string'
      ? packageConfig.bin
      : packageConfig.bin?.[packageName];
  if (!relativeCli) {
    throw new Error(`${packageName} does not declare a CLI entry point.`);
  }
  return path.resolve(path.dirname(packagePath), relativeCli);
}

function runBuild(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args, {
      cwd: codeRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${name} exited with ${signal ?? code}.`));
    });
  });
}

function startNodeProcess(name, script, args, options) {
  const child = spawn(process.execPath, [script, ...args], {
    ...options,
    stdio: 'inherit',
    windowsHide: false,
  });
  children.set(child, name);
  child.once('error', error => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} failed to start:`, error);
      void shutdown(1);
    }
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(
        `[dev] ${name} exited unexpectedly with ${signal ?? code}.`,
      );
      void shutdown(code || 1);
    }
  });
  return child;
}

function spawnNpm(args, options) {
  if (process.platform !== 'win32') {
    return spawn(npmCommand, args, options);
  }
  return spawn(
    'cmd.exe',
    ['/d', '/s', '/c', commandLine(npmCommand, args)],
    options,
  );
}

function commandLine(command, args) {
  return [command, ...args].map(quoteCmdArg).join(' ');
}

function quoteCmdArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function assertPortAvailable(host, port, name) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      const detail =
        error.code === 'EADDRINUSE'
          ? 'The port is already in use, possibly by an earlier dev process.'
          : error.code === 'EACCES'
            ? 'Windows denied access to this port or reserved it.'
            : error.message;
      reject(
        new Error(
          `${name} cannot listen on ${host}:${port} (${error.code}). ${detail}`,
        ),
      );
    });
    probe.listen({host, port, exclusive: true}, () => {
      probe.close(closeError => (closeError ? reject(closeError) : resolve()));
    });
  });
}

async function waitForHttp(url, name, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} stopped before becoming ready.`);
    }
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1000)});
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${name} did not become ready at ${url}: ${lastFailure}`);
}

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  process.exitCode = exitCode;
  const activeChildren = [...children.keys()];
  shutdownPromise = Promise.all(activeChildren.map(stopProcessTree)).then(
    () => {
      children.clear();
      process.exit(exitCode);
    },
  );
  return shutdownPromise;
}

async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        {stdio: 'ignore', windowsHide: true},
      );
      killer.once('error', () => {
        child.kill();
        resolve();
      });
      killer.once('exit', resolve);
    });
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && child.exitCode === null) child.kill('SIGKILL');
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    console.log(`\n[dev] Received ${signal}; stopping backend and WebUI...`);
    void shutdown(signal === 'SIGINT' ? 130 : 143);
  });
}

main().catch(async error => {
  console.error(`[dev] ${error instanceof Error ? error.message : error}`);
  await shutdown(1);
});
