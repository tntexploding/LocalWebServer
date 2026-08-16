import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureReleaseRuntime} from './release-runtime.mjs';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = fileURLToPath(import.meta.url);
const releaseDir = path.join(rootDir, 'release');
const stageDir = path.join(releaseDir, 'local-automation-server');
const archivePath = path.join(
  releaseDir,
  'local-automation-server-win-x64.zip',
);
const checksumPath = `${archivePath}.sha256`;
const runtime = await ensureReleaseRuntime(rootDir);

if (path.resolve(process.execPath) !== path.resolve(runtime.nodePath)) {
  const result = spawnSync(runtime.nodePath, [scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

runNpm(['run', 'build'], rootDir);
assertManagedReleasePath(stageDir);
await rm(stageDir, {recursive: true, force: true});
await rm(archivePath, {force: true});
await rm(checksumPath, {force: true});
await mkdir(stageDir, {recursive: true});

for (const source of [
  'apps/server/dist',
  'apps/web/dist',
  'packages/core/dist',
  'packages/storage/dist',
  'config/actions.example.yaml',
  'config/app.example.yaml',
  'config/endpoints.example.yaml',
  'config/rules.example.yaml',
  'config/secrets.example.yaml',
  'config/README.md',
  'doc/api.md',
  'doc/architecture.md',
  'doc/configuration.md',
  'doc/deployment.md',
  'doc/message_template_standard.md',
  'doc/release.md',
  'doc/security-audit.md',
  'doc/workflow_automation.md',
  'scripts/init-secrets.mjs',
  'scripts/windows',
  'README.md',
  'SECURITY.md',
  'release.config.json',
  'package.json',
  'package-lock.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
  'packages/storage/package.json',
]) {
  await copyPath(source);
}

runNpm(
  [
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    path.join(rootDir, '.npm-cache'),
  ],
  stageDir,
);
runNpm(
  [
    'audit',
    '--omit=dev',
    '--audit-level=low',
    '--cache',
    path.join(rootDir, '.npm-cache'),
  ],
  stageDir,
);
runNpm(
  ['audit', 'signatures', '--cache', path.join(rootDir, '.npm-cache')],
  stageDir,
);
const sbom = runNpm(
  [
    'sbom',
    '--package-lock-only',
    '--omit=dev',
    '--sbom-format=cyclonedx',
    '--cache',
    path.join(rootDir, '.npm-cache'),
  ],
  stageDir,
  true,
);
await writeFile(path.join(stageDir, 'SBOM.cdx.json'), sbom, 'utf8');

await replaceWorkspaceLinks();
await mkdir(path.join(stageDir, 'runtime'), {recursive: true});
await copyFile(runtime.nodePath, path.join(stageDir, 'runtime', 'node.exe'));
await copyFile(
  path.join(runtime.runtimeDir, 'LICENSE'),
  path.join(stageDir, 'runtime', 'NODE-LICENSE.txt'),
);

const sourcePackage = JSON.parse(
  await readFile(path.join(rootDir, 'package.json'), 'utf8'),
);
const portablePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: 'module',
  scripts: {
    start: 'runtime\\node.exe apps/server/dist/index.js',
    'secrets:init': 'runtime\\node.exe scripts/init-secrets.mjs',
  },
};
await writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(portablePackage, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(stageDir, 'initialize.cmd'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'if not exist config\\app.yaml copy /y config\\app.example.yaml config\\app.yaml >nul',
    'if not exist config\\endpoints.yaml copy /y config\\endpoints.example.yaml config\\endpoints.yaml >nul',
    'if not exist config\\rules.yaml copy /y config\\rules.example.yaml config\\rules.yaml >nul',
    'if not exist config\\actions.yaml copy /y config\\actions.example.yaml config\\actions.yaml >nul',
    'runtime\\node.exe scripts\\init-secrets.mjs',
    'echo Initialization complete.',
    '',
  ].join('\r\n'),
  'ascii',
);
await writeFile(
  path.join(stageDir, 'start.cmd'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'set "LAS_ROOT_DIR=%~dp0"',
    'runtime\\node.exe apps\\server\\dist\\index.js',
    '',
  ].join('\r\n'),
  'ascii',
);

await writeReleaseMetadata();
await writeManifest();
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
    'Compress',
    '-Source',
    stageDir,
    '-Destination',
    archivePath,
  ],
);
const archiveHash = await sha256File(archivePath);
await writeFile(
  checksumPath,
  `${archiveHash}  ${path.basename(archivePath)}\n`,
  'ascii',
);
run(runtime.nodePath, [path.join(rootDir, 'scripts', 'verify-portable.mjs')]);
console.log(`Created ${archivePath}`);

async function replaceWorkspaceLinks() {
  const scopeDir = path.join(stageDir, 'node_modules', '@las');
  await rm(scopeDir, {recursive: true, force: true});
  await mkdir(scopeDir, {recursive: true});
  for (const name of ['core', 'storage']) {
    await cp(path.join(stageDir, 'packages', name), path.join(scopeDir, name), {
      recursive: true,
    });
  }
}

async function writeReleaseMetadata() {
  const commit = run('git', ['rev-parse', 'HEAD'], rootDir, true).trim();
  const dirty = run('git', ['status', '--porcelain'], rootDir, true).trim();
  const metadata = {
    schemaVersion: 1,
    application: sourcePackage.name,
    version: sourcePackage.version,
    createdAt: new Date().toISOString(),
    sourceCommit: commit,
    sourceDirty: dirty.length > 0,
    runtime: {
      name: 'Node.js',
      version: runtime.policy.runtime.version,
      platform: runtime.policy.runtime.platform,
      archiveSha256: runtime.policy.runtime.sha256,
    },
    dependencyInstall: 'npm ci --omit=dev --ignore-scripts',
    sbom: 'SBOM.cdx.json',
    manifest: 'MANIFEST.sha256',
  };
  await writeFile(
    path.join(stageDir, 'release-metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
}

async function writeManifest() {
  const files = await listFiles(stageDir);
  const lines = [];
  for (const file of files) {
    const relative = path.relative(stageDir, file).replaceAll('\\', '/');
    if (relative === 'MANIFEST.sha256') continue;
    lines.push(`${await sha256File(file)}  ${relative}`);
  }
  await writeFile(
    path.join(stageDir, 'MANIFEST.sha256'),
    `${lines.join('\n')}\n`,
    'utf8',
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(item)));
    else if (entry.isFile()) files.push(item);
  }
  return files;
}

async function copyPath(relativePath) {
  const source = path.join(rootDir, relativePath);
  const destination = path.join(stageDir, relativePath);
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination, {recursive: true});
}

function runNpm(args, cwd, capture = false) {
  return run(runtime.nodePath, [runtime.npmCliPath, ...args], cwd, capture);
}

function run(command, args, cwd = rootDir, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `: ${result.stderr.trim()}` : '';
    throw new Error(`${command} failed with code ${result.status}${detail}`);
  }
  return capture ? result.stdout : '';
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function assertManagedReleasePath(value) {
  const relative = path.relative(releaseDir, value);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to modify path outside release directory: ${value}`,
    );
  }
}
