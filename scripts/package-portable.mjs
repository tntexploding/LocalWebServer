import {spawnSync} from 'node:child_process';
import {copyFile, cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('The portable package currently targets Windows x64.');
}

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = path.join(rootDir, 'release');
const stageDir = path.join(releaseDir, 'local-automation-server');
const archivePath = path.join(
  releaseDir,
  'local-automation-server-win-x64.zip',
);

assertManagedReleasePath(stageDir);
await rm(stageDir, {recursive: true, force: true});
await rm(archivePath, {force: true});
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
  'doc/development.md',
  'doc/http_communication_spec.md',
  'doc/message_template_standard.md',
  'doc/workflow_automation.md',
  'scripts/init-secrets.mjs',
  'scripts/windows',
  'README.md',
  'SECURITY.md',
  'package-lock.json',
]) {
  await copyPath(source);
}
for (const source of [
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
  'packages/storage/package.json',
]) {
  await copyPath(source);
}

const sourcePackage = JSON.parse(
  await readFile(path.join(rootDir, 'package.json'), 'utf8'),
);
const portablePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: 'module',
  workspaces: ['apps/server', 'packages/core', 'packages/storage'],
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

await mkdir(path.join(stageDir, 'runtime'), {recursive: true});
await copyFile(process.execPath, path.join(stageDir, 'runtime', 'node.exe'));

const npmResult = spawnSync(
  process.env.ComSpec ?? 'cmd.exe',
  [
    '/d',
    '/s',
    '/c',
    'npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund',
  ],
  {cwd: stageDir, stdio: 'inherit', windowsHide: true},
);
if (npmResult.error) throw npmResult.error;
if (npmResult.status !== 0) {
  throw new Error(
    `Portable production dependency install failed: ${npmResult.status}`,
  );
}

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

const archiveResult = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -LiteralPath '${escapePowerShell(stageDir)}' -DestinationPath '${escapePowerShell(archivePath)}' -CompressionLevel Optimal -Force`,
  ],
  {cwd: releaseDir, stdio: 'inherit', windowsHide: true},
);
if (archiveResult.status !== 0) {
  throw new Error(`Portable archive creation failed: ${archiveResult.status}`);
}
console.log(`Created ${archivePath}`);

async function copyPath(relativePath) {
  const source = path.join(rootDir, relativePath);
  const destination = path.join(stageDir, relativePath);
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination, {recursive: true});
}

function assertManagedReleasePath(value) {
  const relative = path.relative(releaseDir, value);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to modify path outside release directory: ${value}`,
    );
  }
}

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}
