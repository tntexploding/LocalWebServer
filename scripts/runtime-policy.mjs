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
    !isVersion(policy.recommendedNodeVersion) ||
    !Number.isInteger(policy.recommendedNodeMajor) ||
    policy.recommendedNodeMajor < 1 ||
    !isVersion(policy.runtime?.version) ||
    policy.runtime?.platform !== 'win-x64' ||
    policy.runtime?.downloadBaseUrl !== 'https://nodejs.org/dist' ||
    !/^node-v[0-9.]+-win-x64\.zip$/u.test(policy.runtime?.archive ?? '') ||
    !/^[0-9a-f]{64}$/u.test(policy.runtime?.sha256 ?? '')
  ) {
    throw new Error('release.config.json is invalid.');
  }
  if (
    versionParts(policy.runtime.version)[0] !== policy.recommendedNodeMajor ||
    compareVersions(policy.runtime.version, policy.recommendedNodeVersion) <
      0 ||
    policy.runtime.archive !==
      `node-v${policy.runtime.version}-${policy.runtime.platform}.zip`
  ) {
    throw new Error('release.config.json contains an inconsistent runtime.');
  }
  return policy;
}

/** Describes a runtime mismatch without preventing local startup. */
export function runtimeRecommendation(current, recommended, recommendedMajor) {
  if (versionParts(current)[0] !== recommendedMajor) {
    return `Node.js ${current} differs from the recommended Node.js ${recommendedMajor}.x runtime; compatibility is not guaranteed.`;
  }
  if (compareVersions(current, recommended) < 0) {
    return `Node.js ${current} is older than the recommended ${recommended} runtime; update when practical.`;
  }
  return undefined;
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
