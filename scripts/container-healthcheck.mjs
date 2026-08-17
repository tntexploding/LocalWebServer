import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);

try {
  const appConfig = YAML.parse(
    await readFile(path.join(rootDir, 'config', 'app.yaml'), 'utf8'),
  );
  const port = appConfig?.server?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('config/app.yaml does not contain a valid server port.');
  }
  const healthUrl =
    process.env.LAS_HEALTHCHECK_URL ?? `http://127.0.0.1:${port}/api/health`;
  const response = await fetch(healthUrl, {
    headers: {accept: 'application/json'},
    signal: AbortSignal.timeout(3_000),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Health endpoint returned HTTP ${response.status}.`);
  }
} catch (error) {
  console.error(`Container health check failed: ${error.message}`);
  process.exitCode = 1;
}
