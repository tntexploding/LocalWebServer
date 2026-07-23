import {randomUUID} from 'node:crypto';
import {chmod, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const codeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const targetPath = path.join(rootDir, 'config', 'app.yaml');
const examplePath = path.join(codeRoot, 'config', 'app.example.yaml');
const [targetSource, exampleSource] = await Promise.all([
  readFile(targetPath, 'utf8'),
  readFile(examplePath, 'utf8'),
]);
const target = requireRecord(YAML.parse(targetSource), targetPath);
const example = requireRecord(YAML.parse(exampleSource), examplePath);
const normalized = mergeMissing(target, example);
const output = YAML.stringify(normalized);

if (output === YAML.stringify(target)) {
  console.log('Local application configuration is already explicit.');
} else {
  await writeAtomically(targetPath, output, 0o600);
  console.log(
    'Filled missing app.yaml fields from config/app.example.yaml without replacing existing values.',
  );
}

function mergeMissing(targetValue, exampleValue) {
  const result = structuredClone(targetValue);
  for (const [key, fallback] of Object.entries(exampleValue)) {
    if (!(key in result) || result[key] === undefined) {
      result[key] = structuredClone(fallback);
      continue;
    }
    if (isRecord(result[key]) && isRecord(fallback)) {
      result[key] = mergeMissing(result[key], fallback);
    }
  }
  return result;
}

async function writeAtomically(filePath, content, mode) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      content.endsWith('\n') ? content : `${content}\n`,
      {encoding: 'utf8', flag: 'wx', mode},
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

function requireRecord(value, filePath) {
  if (!isRecord(value)) throw new Error(`${filePath} must contain an object.`);
  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
