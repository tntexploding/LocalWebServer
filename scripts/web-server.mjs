import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDevelopmentSettings} from './development-settings.mjs';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'preview') {
  throw new Error('Usage: node scripts/web-server.mjs <dev|preview>');
}

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRoot = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const webRoot = path.join(codeRoot, 'apps', 'web');
const settings = await loadDevelopmentSettings(projectRoot);
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
const vitePackagePath = requireFromWeb.resolve('vite/package.json');
const vitePackage = requireFromWeb(vitePackagePath);
const viteCli = path.resolve(
  path.dirname(vitePackagePath),
  vitePackage.bin.vite,
);
const port = mode === 'dev' ? settings.webPort : settings.previewPort;
const args = [
  ...(mode === 'preview' ? ['preview'] : []),
  '--host',
  settings.webHost,
  '--port',
  String(port),
  '--strictPort',
];
const child = spawn(process.execPath, [viteCli, ...args], {
  cwd: webRoot,
  env: {...process.env, VITE_API_BASE: settings.apiBase},
  stdio: 'inherit',
  windowsHide: false,
});

child.once('error', error => {
  console.error(`[web] Failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => child.kill(signal));
}
