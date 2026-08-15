import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, readFile, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {loadReleasePolicy} from './runtime-policy.mjs';

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

/** Downloads, verifies, and extracts the pinned Windows Node.js runtime. */
export async function ensureReleaseRuntime(rootDir) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(
      'The pinned release runtime currently supports Windows x64.',
    );
  }
  const policy = await loadReleasePolicy(rootDir);
  const cacheDir = path.join(rootDir, '.release-cache');
  const archivePath = path.join(cacheDir, policy.runtime.archive);
  const runtimeName = policy.runtime.archive.replace(/\.zip$/u, '');
  const runtimeDir = path.join(cacheDir, runtimeName);
  await mkdir(cacheDir, {recursive: true});

  if (!(await fileHashMatches(archivePath, policy.runtime.sha256))) {
    await rm(archivePath, {force: true});
    const url = `${policy.runtime.downloadBaseUrl}/v${policy.runtime.version}/${policy.runtime.archive}`;
    await downloadVerified(url, archivePath, policy.runtime.sha256);
  }

  const nodePath = path.join(runtimeDir, 'node.exe');
  const npmCliPath = path.join(
    runtimeDir,
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
  if (!(await isExpectedRuntime(nodePath, policy.runtime.version))) {
    await rm(runtimeDir, {recursive: true, force: true});
    const extractDir = path.join(cacheDir, `extract-${process.pid}`);
    await rm(extractDir, {recursive: true, force: true});
    await mkdir(extractDir, {recursive: true});
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
          extractDir,
        ],
      );
      const extracted = path.join(extractDir, runtimeName);
      await rename(extracted, runtimeDir);
    } finally {
      await rm(extractDir, {recursive: true, force: true});
    }
  }
  if (!(await isExpectedRuntime(nodePath, policy.runtime.version))) {
    throw new Error('Extracted Node.js runtime failed its version check.');
  }
  await stat(npmCliPath);
  return {nodePath, npmCliPath, policy, runtimeDir};
}

async function downloadVerified(url, destination, expectedHash) {
  const temporary = `${destination}.${process.pid}.tmp`;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const curlPath = path.join(systemRoot, 'System32', 'curl.exe');
  await rm(temporary, {force: true});
  console.log(`Downloading pinned Node.js runtime from ${url}`);
  try {
    run(curlPath, [
      '--fail',
      '--show-error',
      '--silent',
      '--proto',
      '=https',
      '--tlsv1.2',
      '--connect-timeout',
      '30',
      '--max-time',
      '900',
      '--retry',
      '3',
      '--retry-all-errors',
      '--output',
      temporary,
      url,
    ]);
    const details = await stat(temporary);
    if (details.size === 0 || details.size > MAX_ARCHIVE_BYTES) {
      throw new Error('Node.js runtime archive has an invalid size.');
    }
    const actualHash = createHash('sha256')
      .update(await readFile(temporary))
      .digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error('Node.js runtime archive failed SHA-256 verification.');
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}

async function fileHashMatches(filePath, expectedHash) {
  try {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex') === expectedHash;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isExpectedRuntime(nodePath, expectedVersion) {
  try {
    const result = spawnSync(nodePath, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return (
      result.status === 0 && result.stdout.trim() === `v${expectedVersion}`
    );
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with code ${result.status}: ${result.stderr.trim()}`,
    );
  }
}
