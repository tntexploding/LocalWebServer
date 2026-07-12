import {rm} from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const GENERATED_PATHS = [
  '.dev-action-ui.err.log',
  '.dev-action-ui.out.log',
  'apps/server/dist',
  'apps/server/tsconfig.tsbuildinfo',
  'apps/web/dist',
  'apps/web/tsconfig.tsbuildinfo',
  'packages/core/dist',
  'packages/core/tsconfig.tsbuildinfo',
  'packages/storage/dist',
  'packages/storage/tsconfig.tsbuildinfo',
];

await Promise.all(
  GENERATED_PATHS.map(relativePath =>
    rm(path.join(ROOT_DIR, relativePath), {force: true, recursive: true}),
  ),
);
