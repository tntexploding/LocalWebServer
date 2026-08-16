import {readFile} from 'node:fs/promises';
import path from 'node:path';

interface ReleasePolicy {
  schemaVersion: number;
  recommendedNodeVersion: string;
  recommendedNodeMajor: number;
}

/** Reports a Node.js recommendation without preventing local startup. */
export async function reportRuntimeRecommendation(
  codeRoot: string,
  warn: (message: string) => void = message => console.warn(message),
): Promise<boolean> {
  const source = await readFile(
    path.join(codeRoot, 'release.config.json'),
    'utf8',
  );
  const policy = JSON.parse(source) as Partial<ReleasePolicy>;
  if (
    policy.schemaVersion !== 1 ||
    !isVersion(policy.recommendedNodeVersion) ||
    typeof policy.recommendedNodeMajor !== 'number' ||
    !Number.isInteger(policy.recommendedNodeMajor)
  ) {
    throw new Error('release.config.json contains an invalid runtime policy.');
  }
  const current = process.versions.node;
  const currentParts = versionParts(current);
  if (currentParts[0] !== policy.recommendedNodeMajor) {
    warn(
      `Node.js ${current} differs from the recommended Node.js ${policy.recommendedNodeMajor}.x runtime; startup will continue, but compatibility is not guaranteed.`,
    );
    return false;
  }
  if (compareVersions(current, policy.recommendedNodeVersion) < 0) {
    warn(
      `Node.js ${current} is older than the recommended ${policy.recommendedNodeVersion} runtime; startup will continue.`,
    );
    return false;
  }
  return true;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionParts(value: string): number[] {
  if (!isVersion(value)) throw new Error(`Invalid Node.js version: ${value}`);
  return value.split('.').map(Number);
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);
}
