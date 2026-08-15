import {readFile} from 'node:fs/promises';
import path from 'node:path';

/** Loads and validates the tracked release/runtime policy. */
export async function loadReleasePolicy(rootDir) {
  const source = await readFile(
    path.join(rootDir, 'release.config.json'),
    'utf8',
  );
  const policy = JSON.parse(source);
  if (
    policy?.schemaVersion !== 1 ||
    !isVersion(policy.minimumNodeVersion) ||
    !Number.isInteger(policy.supportedNodeMajor) ||
    policy.supportedNodeMajor < 1 ||
    !isVersion(policy.runtime?.version) ||
    policy.runtime?.platform !== 'win-x64' ||
    policy.runtime?.downloadBaseUrl !== 'https://nodejs.org/dist' ||
    !/^node-v[0-9.]+-win-x64\.zip$/u.test(policy.runtime?.archive ?? '') ||
    !/^[0-9a-f]{64}$/u.test(policy.runtime?.sha256 ?? '')
  ) {
    throw new Error('release.config.json is invalid.');
  }
  if (
    versionParts(policy.runtime.version)[0] !== policy.supportedNodeMajor ||
    compareVersions(policy.runtime.version, policy.minimumNodeVersion) < 0 ||
    policy.runtime.archive !==
      `node-v${policy.runtime.version}-${policy.runtime.platform}.zip`
  ) {
    throw new Error('release.config.json contains an inconsistent runtime.');
  }
  return policy;
}

/** Rejects Node releases older than the security baseline. */
export function assertSecureRuntime(current, minimum, supportedMajor) {
  if (versionParts(current)[0] !== supportedMajor) {
    throw new Error(
      `Node.js ${current} is unsupported; this release requires Node.js ${supportedMajor}.x.`,
    );
  }
  if (compareVersions(current, minimum) < 0) {
    throw new Error(
      `Node.js ${current} is below the security baseline ${minimum}. Update Node.js before starting the service.`,
    );
  }
}

export function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionParts(value) {
  if (!isVersion(value)) throw new Error(`Invalid semantic version: ${value}`);
  return value.split('.').map(Number);
}

function isVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);
}
