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
const configDir = path.join(rootDir, 'config');
const appPath = path.join(configDir, 'app.yaml');
const secretsPath = resolveManagedPath(
  process.env.LAS_SECRETS_PATH ?? 'config/secrets.yaml',
);
const SENSITIVE_CONFIG_KEY =
  /(authorization|cookie|credential|password|private.?key|secret|token|api.?key)/iu;
const CONFIG_REFERENCE =
  /\$\{(?:secret:[A-Za-z][A-Za-z0-9_.-]*|env:[A-Za-z_][A-Za-z0-9_]*)\}|\$\{\{/u;

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

const documents = new Map([['app', {path: appPath, value: app}]]);
for (const name of ['endpoints', 'rules', 'actions']) {
  const document = await readOptionalConfig(name);
  if (document) documents.set(name, document);
}

let migratedCredentials = 0;
const changedDocuments = new Set(['app']);
for (const [name, document] of documents) {
  const migrated = migrateInlineCredentials(
    document.value,
    name,
    secretsDocument.secrets,
  );
  migratedCredentials += migrated;
  if (migrated > 0) changedDocuments.add(name);
}

await writeAtomically(secretsPath, YAML.stringify(secretsDocument), 0o600);
for (const name of changedDocuments) {
  const document = documents.get(name);
  await writeAtomically(document.path, YAML.stringify(document.value), 0o600);
}
console.log(
  `Separated API credentials and ${migratedCredentials} inline credential value(s) into config/secrets.yaml.`,
);

function moveToken(security, secrets, name) {
  const current = security[name];
  if (
    typeof current === 'string' &&
    !current.startsWith('${') &&
    !isUnsafeToken(current)
  ) {
    secrets[name] = current;
  }
  if (isUnsafeToken(secrets[name])) {
    secrets[name] = randomBytes(32).toString('base64url');
  }
  if (typeof current !== 'string' || !current.startsWith('${env:')) {
    security[name] = `\${secret:${name}}`;
  }
}

function isUnsafeToken(value) {
  return (
    typeof value !== 'string' ||
    value.length < 32 ||
    /^(?:change|example|replace|test)[-_]/iu.test(value)
  );
}

async function readOptionalConfig(name) {
  const filePath = path.join(configDir, `${name}.yaml`);
  try {
    return {
      path: filePath,
      value: YAML.parse(await readFile(filePath, 'utf8')),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function migrateInlineCredentials(value, currentPath, secrets) {
  if (Array.isArray(value)) {
    return value.reduce(
      (count, item, index) =>
        count +
        migrateInlineCredentials(item, `${currentPath}[${index}]`, secrets),
      0,
    );
  }
  if (!isRecord(value)) return 0;

  let migrated = 0;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${currentPath}.${key}`;
    if (
      SENSITIVE_CONFIG_KEY.test(key) &&
      typeof item === 'string' &&
      item.trim() !== '' &&
      !CONFIG_REFERENCE.test(item)
    ) {
      const name = storeSecret(secrets, secretName(itemPath), item);
      value[key] = `\${secret:${name}}`;
      migrated += 1;
      continue;
    }
    migrated += migrateInlineCredentials(item, itemPath, secrets);
  }
  return migrated;
}

function storeSecret(secrets, requestedName, value) {
  const existing = Object.entries(secrets).find(
    ([, candidate]) => candidate === value,
  );
  if (existing) return existing[0];

  let name = requestedName;
  let suffix = 2;
  while (secrets[name] !== undefined && secrets[name] !== value) {
    name = `${requestedName}.${suffix}`;
    suffix += 1;
  }
  secrets[name] = value;
  return name;
}

function secretName(value) {
  const normalized = value
    .replace(/\[(\d+)\]/gu, '.$1')
    .replace(/[^A-Za-z0-9_.-]/gu, '-')
    .replace(/^[^A-Za-z]+/u, 'local.');
  return normalized || 'local.credential';
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
