import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assertDevelopmentOriginAllowed,
  loadDevelopmentSettings,
} from './development-settings.mjs';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const serverRoot = path.join(codeRoot, 'apps', 'server');
const webRoot = path.join(codeRoot, 'apps', 'web');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Map();
let shuttingDown = false;
let shutdownPromise;

async function main() {
  const configuredSettings = await loadDevelopmentSettings(projectRoot);
  assertDevelopmentOriginAllowed(configuredSettings);
  await assertPortAvailable(
    configuredSettings.backendHost,
    configuredSettings.backendPort,
    'backend',
  );
  const webPort = await resolveWebPort(
    configuredSettings.webHost,
    configuredSettings.webPort,
  );
  const settings = withWebPort(configuredSettings, webPort);

  await runBuild('build:core', ['run', 'build', '-w', '@las/core']);
  await runBuild('build:storage', ['run', 'build', '-w', '@las/storage']);

  console.log('[dev] Starting backend and WebUI...');
  const server = startNodeProcess(
    'server',
    resolvePackageCli(serverRoot, 'tsx'),
    ['watch', 'src/index.ts'],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        LAS_DEV_WEB_ORIGIN: new URL(settings.webUrl).origin,
      },
    },
  );
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
  await Promise.all([
    waitForHttp(`${settings.apiBase}/api/health`, 'backend', server),
    waitForHttp(settings.webUrl, 'WebUI', web),
  ]);

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
    children.set(child, name);
    child.once('error', error => {
      children.delete(child);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
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
    detached: process.platform !== 'win32',
    windowsHide: true,
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
    return spawn(npmCommand, args, {...options, detached: true});
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
  try {
    await probePort(host, port);
  } catch (error) {
    throw portError(host, port, name, error);
  }
}

async function resolveWebPort(host, configuredPort) {
  try {
    await probePort(host, configuredPort);
    return configuredPort;
  } catch (error) {
    if (!['EACCES', 'EADDRINUSE'].includes(error?.code)) {
      throw portError(host, configuredPort, 'WebUI', error);
    }
    const fallbackPort = await allocatePort(host);
    console.warn(
      `[dev] WebUI port ${host}:${configuredPort} is unavailable (${error.code}); ` +
        `using ${host}:${fallbackPort} for this session.`,
    );
    return fallbackPort;
  }
}

function withWebPort(settings, webPort) {
  if (settings.webPort === webPort) return settings;
  const webUrl = new URL(settings.webUrl);
  webUrl.port = String(webPort);
  return {...settings, webPort, webUrl: webUrl.href};
}

function probePort(host, port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({host, port, exclusive: true}, () => {
      probe.close(closeError => (closeError ? reject(closeError) : resolve()));
    });
  });
}

async function allocatePort(host) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({host, port: 0, exclusive: true}, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => {
        if (error) reject(error);
        else if (port > 0) resolve(port);
        else reject(new Error(`Could not allocate a WebUI port on ${host}.`));
      });
    });
  });
}

function portError(host, port, name, error) {
  const detail =
    error?.code === 'EADDRINUSE'
      ? 'The port is already in use, possibly by an earlier dev process.'
      : error?.code === 'EACCES'
        ? 'Windows denied access to this port or reserved it.'
        : error instanceof Error
          ? error.message
          : String(error);
  return new Error(
    `${name} cannot listen on ${host}:${port} (${error?.code ?? 'unknown'}). ${detail}`,
  );
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
    const stopped = await new Promise(resolve => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        {stdio: 'ignore', windowsHide: true},
      );
      killer.once('error', () => {
        resolve(false);
      });
      killer.once('exit', code => resolve(code === 0));
    });
    if (!stopped && child.exitCode === null) {
      console.warn(
        `[dev] Could not stop process tree ${child.pid}; stopping its parent process directly.`,
      );
      child.kill('SIGKILL');
    }
    await waitForProcessExit(child, 2000);
    return;
  }
  signalProcessGroup(child, 'SIGTERM');
  const exited = await waitForProcessExit(child, 3000);
  if (!exited && child.exitCode === null) signalProcessGroup(child, 'SIGKILL');
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

function signalProcessGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
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
