import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const lock = JSON.parse(
  await readFile(path.join(rootDir, 'package-lock.json'), 'utf8'),
);
const violations = [];
const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
]);

if (lock.lockfileVersion !== 3) {
  violations.push('package-lock.json must use lockfileVersion 3.');
}

let productionPackages = 0;
for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!packagePath.startsWith('node_modules/')) continue;
  if (metadata.link || metadata.dev) continue;
  productionPackages += 1;
  const label = `${packagePath.slice('node_modules/'.length)}@${metadata.version ?? '<unknown>'}`;
  if (
    typeof metadata.resolved !== 'string' ||
    !metadata.resolved.startsWith('https://registry.npmjs.org/')
  ) {
    violations.push(`${label} does not use the official HTTPS npm registry.`);
  }
  if (
    typeof metadata.integrity !== 'string' ||
    !metadata.integrity.startsWith('sha512-')
  ) {
    violations.push(
      `${label} does not have a SHA-512 lockfile integrity value.`,
    );
  }
  if (!allowedLicenses.has(metadata.license)) {
    violations.push(
      `${label} uses an unreviewed license: ${metadata.license ?? '<missing>'}.`,
    );
  }
  if (metadata.hasInstallScript) {
    violations.push(`${label} runs an installation script in production.`);
  }
}

if (violations.length > 0) {
  console.error('Dependency lock audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Dependency lock audit passed: ${productionPackages} production packages use reviewed licenses, registry URLs, and integrity hashes.`,
  );
}
