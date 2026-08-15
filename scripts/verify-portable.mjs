import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadReleasePolicy} from './runtime-policy.mjs';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = path.join(rootDir, 'release');
const stageDir = path.join(releaseDir, 'local-automation-server');
const archivePath = path.join(
  releaseDir,
  'local-automation-server-win-x64.zip',
);
const checksumPath = `${archivePath}.sha256`;
const verificationRoot = path.join(
  rootDir,
  '.release-cache',
  `verify-portable-${process.pid}`,
);
const policy = await loadReleasePolicy(rootDir);

await assertFile(path.join(stageDir, 'SBOM.cdx.json'));
await assertFile(path.join(stageDir, 'release-metadata.json'));
await verifyManifest(stageDir);
await verifyArchiveChecksum();
verifyRuntime(stageDir);
await verifyNoPrivateRuntimeFiles(stageDir);
await verifyExtractedRelease();
console.log('Portable release verification passed.');

async function verifyManifest(releaseRoot) {
  const source = await readFile(
    path.join(releaseRoot, 'MANIFEST.sha256'),
    'utf8',
  );
  const expected = new Map();
  for (const line of source.trim().split('\n')) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line.trimEnd());
    if (!match) throw new Error(`Invalid manifest line: ${line}`);
    expected.set(match[2], match[1]);
  }
  const files = await listFiles(releaseRoot);
  for (const file of files) {
    const relative = path.relative(releaseRoot, file).replaceAll('\\', '/');
    if (relative === 'MANIFEST.sha256') continue;
    const hash = expected.get(relative);
    if (!hash || hash !== (await sha256File(file))) {
      throw new Error(`Manifest verification failed: ${relative}`);
    }
    expected.delete(relative);
  }
  if (expected.size > 0) {
    throw new Error(
      `Manifest references missing file: ${expected.keys().next().value}`,
    );
  }
}

async function verifyArchiveChecksum() {
  const source = (await readFile(checksumPath, 'ascii')).trim();
  const expected = source.split(/\s+/u)[0];
  if (!/^[0-9a-f]{64}$/u.test(expected)) {
    throw new Error('Portable archive checksum file is invalid.');
  }
  if ((await sha256File(archivePath)) !== expected) {
    throw new Error('Portable archive SHA-256 verification failed.');
  }
}

function verifyRuntime(releaseRoot) {
  const nodePath = path.join(releaseRoot, 'runtime', 'node.exe');
  const result = spawnSync(nodePath, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (
    result.status !== 0 ||
    result.stdout.trim() !== `v${policy.runtime.version}`
  ) {
    throw new Error('Bundled runtime version verification failed.');
  }
}

async function verifyNoPrivateRuntimeFiles(releaseRoot) {
  const forbidden = [
    'config/app.yaml',
    'config/endpoints.yaml',
    'config/rules.yaml',
    'config/actions.yaml',
    'config/secrets.yaml',
    'config/web.yaml',
    'config/templates',
    'doc/template',
    'data',
  ];
  for (const relative of forbidden) {
    try {
      await stat(path.join(releaseRoot, relative));
      throw new Error(`Private runtime path entered release: ${relative}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function verifyExtractedRelease() {
  assertManagedVerificationPath(verificationRoot);
  await rm(verificationRoot, {recursive: true, force: true});
  await mkdir(verificationRoot, {recursive: true});
  try {
    run(
      path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(rootDir, 'scripts', 'windows', 'archive-release.ps1'),
        '-Mode',
        'Expand',
        '-Source',
        archivePath,
        '-Destination',
        verificationRoot,
      ],
    );
    const extractedRoot = path.join(
      verificationRoot,
      'local-automation-server',
    );
    await verifyManifest(extractedRoot);
    verifyRuntime(extractedRoot);
    await verifyNoPrivateRuntimeFiles(extractedRoot);
    await smokeTest(extractedRoot);
  } finally {
    await rm(verificationRoot, {recursive: true, force: true});
  }
}

async function smokeTest(releaseRoot) {
  run(
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
    ['/d', '/s', '/c', 'initialize.cmd'],
    releaseRoot,
  );
  const port = await availablePort();
  const appPath = path.join(releaseRoot, 'config', 'app.yaml');
  let appConfig = await readFile(appPath, 'utf8');
  if (
    !appConfig.includes('  port: 4789') ||
    !appConfig.includes('  requireTokenForRead: true')
  ) {
    throw new Error('Portable example configuration cannot be smoke-tested.');
  }
  appConfig = appConfig
    .replace('  port: 4789', `  port: ${port}`)
    .replace('  requireTokenForRead: true', '  requireTokenForRead: false');
  await writeFile(appPath, appConfig, 'utf8');

  const nodePath = path.join(releaseRoot, 'runtime', 'node.exe');
  const child = spawn(nodePath, ['apps/server/dist/index.js'], {
    cwd: releaseRoot,
    env: {...process.env, LAS_ROOT_DIR: releaseRoot},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let spawnError;
  child.once('error', error => {
    spawnError = error;
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const appendOutput = chunk => {
    output = `${output}${chunk}`.slice(-8000);
  };
  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  try {
    await waitForHealth(
      child,
      `http://127.0.0.1:${port}/api/health`,
      () => output.slice(-4000),
      () => spawnError,
    );
  } finally {
    await stopChild(child);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error('Could not reserve a portable smoke-test port.');
  return port;
}

async function waitForHealth(child, url, output, spawnFailure) {
  const deadline = Date.now() + 15000;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    const failure = spawnFailure();
    if (failure) throw failure;
    if (child.exitCode !== null) {
      throw new Error(
        `Portable server exited before becoming ready (${child.exitCode}). ${output()}`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).ok === true) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(
    `Portable server health check timed out: ${lastFailure}. ${output()}`,
  );
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with code ${result.status}: ${(result.stderr ?? '').trim()}`,
    );
  }
}

function assertManagedVerificationPath(value) {
  const cacheRoot = path.join(rootDir, '.release-cache');
  const relative = path.relative(cacheRoot, value);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to modify verification path: ${value}`);
  }
}

async function assertFile(filePath) {
  const details = await stat(filePath);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`Required release file is empty: ${filePath}`);
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(item)));
    else if (entry.isFile()) files.push(item);
  }
  return files;
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}
