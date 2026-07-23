import {randomBytes, randomUUID} from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const appPath = path.join(rootDir, 'config', 'app.yaml');
const secretsPath = resolveManagedPath(
  process.env.LAS_SECRETS_PATH ?? 'config/secrets.yaml',
);

const app = YAML.parse(await readFile(appPath, 'utf8'));
if (!app || typeof app !== 'object' || !app.security) {
  throw new Error('config/app.yaml requires a security object.');
}

let secretsDocument = {version: 1, secrets: {}};
try {
  const existing = YAML.parse(await readFile(secretsPath, 'utf8'));
  if (existing?.version === 1 && isRecord(existing.secrets)) {
    secretsDocument = existing;
  } else {
    throw new Error('Existing secrets file is not a version 1 document.');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

moveToken(app.security, secretsDocument.secrets, 'apiToken');
moveToken(app.security, secretsDocument.secrets, 'operatorToken');
moveToken(app.security, secretsDocument.secrets, 'readToken');
app.version = 1;

await writeAtomically(secretsPath, YAML.stringify(secretsDocument), 0o600);
await writeAtomically(appPath, YAML.stringify(app), 0o600);
console.log('Separated API credentials into config/secrets.yaml.');

function moveToken(security, secrets, name) {
  const current = security[name];
  if (typeof current === 'string' && !current.startsWith('${')) {
    secrets[name] = current;
  }
  if (typeof secrets[name] !== 'string' || secrets[name].length === 0) {
    secrets[name] = randomBytes(32).toString('base64url');
  }
  if (typeof current !== 'string' || !current.startsWith('${env:')) {
    security[name] = `\${secret:${name}}`;
  }
}

async function writeAtomically(filePath, content, mode) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      content.endsWith('\n') ? content : `${content}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode,
      },
    );
    await rename(temporary, filePath);
    await chmod(filePath, mode).catch(error => {
      if (process.platform !== 'win32') throw error;
    });
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveManagedPath(value) {
  const resolved = path.resolve(rootDir, value);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Secret path must stay inside the project root: ${value}`);
  }
  return resolved;
}
