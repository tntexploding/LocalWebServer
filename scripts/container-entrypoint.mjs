import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootstrapContainerRuntime} from './container-runtime.mjs';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
process.env.LAS_ROOT_DIR = rootDir;

const copied = await bootstrapContainerRuntime({codeRoot, rootDir});
if (copied.length > 0) {
  console.log(`Initialized container configuration: ${copied.join(', ')}`);
}

await import('./init-secrets.mjs');
await import('../apps/server/dist/index.js');
