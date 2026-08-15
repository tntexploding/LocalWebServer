import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSecureRuntime, loadReleasePolicy} from './runtime-policy.mjs';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const policy = await loadReleasePolicy(rootDir);
assertSecureRuntime(
  process.versions.node,
  policy.minimumNodeVersion,
  policy.supportedNodeMajor,
);
console.log(
  `Node.js ${process.versions.node} satisfies security baseline ${policy.minimumNodeVersion}.`,
);
