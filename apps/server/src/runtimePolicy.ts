import {readFile} from 'node:fs/promises';
import path from 'node:path';

interface ReleasePolicy {
  schemaVersion: number;
  minimumNodeVersion: string;
  supportedNodeMajor: number;
}

/** Enforces the tracked, security-supported Node.js range at server startup. */
export async function assertSupportedRuntime(codeRoot: string): Promise<void> {
  const source = await readFile(
    path.join(codeRoot, 'release.config.json'),
    'utf8',
  );
  const policy = JSON.parse(source) as Partial<ReleasePolicy>;
  if (
    policy.schemaVersion !== 1 ||
    !isVersion(policy.minimumNodeVersion) ||
    typeof policy.supportedNodeMajor !== 'number' ||
    !Number.isInteger(policy.supportedNodeMajor)
  ) {
    throw new Error('release.config.json contains an invalid runtime policy.');
  }
  const current = process.versions.node;
  const currentParts = versionParts(current);
  if (currentParts[0] !== policy.supportedNodeMajor) {
    throw new Error(
      `Node.js ${current} is unsupported; this service requires Node.js ${policy.supportedNodeMajor}.x.`,
    );
  }
  if (compareVersions(current, policy.minimumNodeVersion) < 0) {
    throw new Error(
      `Node.js ${current} is below the security baseline ${policy.minimumNodeVersion}.`,
    );
  }
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
