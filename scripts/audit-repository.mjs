import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const violations = [];
const REQUIRED_IGNORES = [
  '.env',
  '.npmrc',
  '.npm-cache/index-v5/private-package',
  'config/app.yaml',
  'config/endpoints.yaml',
  'config/rules.yaml',
  'config/actions.yaml',
  'config/web.yaml',
  'config/secrets.yaml',
  'config/templates/message.json',
  'doc/template/private.json',
  'data/events.jsonl',
  'release/application.zip',
  'tests/.artifacts/report.json',
];
const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  [
    'GitHub token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  ],
  ['OpenAI token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/u],
  ['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/u],
  [
    'JSON Web Token',
    /\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/u,
  ],
  ['credential-bearing URL', /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu],
];
const HARDCODED_SECRET_VALUE =
  /\b(?:api.?key|api.?token|access.?token|auth.?token|client.?secret|password)\b\s*[:=]\s*(['"`])(?!\$\{|\[REDACTED\]|<|example-|replace-|test-)[^'"`\r\n]{8,}\1/iu;
const LOCAL_URL_WITH_PORT =
  /\b(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[?::1\]?):\d{2,5}\b/iu;
const repositoryFiles = git([
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
])
  .split('\0')
  .filter(Boolean)
  .map(value => value.replaceAll('\\', '/'));

for (const relativePath of repositoryFiles) {
  if (isForbiddenTrackedPath(relativePath)) {
    violations.push(
      `Sensitive or machine-local path is tracked: ${relativePath}`,
    );
    continue;
  }
  const content = await readText(relativePath);
  if (content === undefined) continue;
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`${name} pattern found in tracked file: ${relativePath}`);
    }
  }
  if (isRuntimeSource(relativePath) && LOCAL_URL_WITH_PORT.test(content)) {
    violations.push(
      `Hard-coded local URL found in runtime source: ${relativePath}`,
    );
  }
  if (isRuntimeSource(relativePath) && HARDCODED_SECRET_VALUE.test(content)) {
    violations.push(
      `Hard-coded credential value found in runtime source: ${relativePath}`,
    );
  }
}

for (const probe of REQUIRED_IGNORES) {
  const result = spawnGit(['check-ignore', '--no-index', '--quiet', probe]);
  if (result.status !== 0) {
    violations.push(`Required machine-local path is not ignored: ${probe}`);
  }
}

await auditExamples();

if (violations.length > 0) {
  console.error('Repository audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Repository audit passed: ${repositoryFiles.length} candidate files, no local configuration or obvious secret material detected.`,
  );
}

async function auditExamples() {
  const app = YAML.parse(await readRequired('config/app.example.yaml'));
  const endpoints = YAML.parse(
    await readRequired('config/endpoints.example.yaml'),
  );
  const rules = YAML.parse(await readRequired('config/rules.example.yaml'));
  for (const name of ['apiToken', 'operatorToken', 'readToken']) {
    const value = app?.security?.[name];
    if (
      typeof value !== 'string' ||
      (!value.startsWith('${secret:') && !value.startsWith('${env:'))
    ) {
      violations.push(`config/app.example.yaml ${name} must use a reference.`);
    }
  }
  if (app?.security?.requireTokenForRead !== true) {
    violations.push('config/app.example.yaml must require a read token.');
  }
  if (app?.security?.allowShell !== false) {
    violations.push('config/app.example.yaml must disable Shell execution.');
  }
  if ((app?.security?.allowedCommandRoots ?? []).length !== 0) {
    violations.push(
      'config/app.example.yaml must not enable a command root by default.',
    );
  }
  const endpointEntries = [
    ...(endpoints?.httpServers ?? []),
    ...(endpoints?.wsServers ?? []),
    ...(endpoints?.httpClients ?? []),
    ...(endpoints?.wsClients ?? []),
  ];
  if (endpointEntries.some(endpoint => endpoint.enabled !== false)) {
    violations.push('Every example endpoint must be disabled by default.');
  }
  if ((rules?.rules ?? []).some(rule => rule.enabled !== false)) {
    violations.push('Every example automation must be disabled by default.');
  }
}

function isForbiddenTrackedPath(relativePath) {
  const lower = relativePath.toLowerCase();
  const base = path.posix.basename(lower);
  if (lower.startsWith('config/')) {
    return lower !== 'config/readme.md' && !/\.example\.ya?ml$/u.test(lower);
  }
  if (
    lower.startsWith('data/') ||
    lower.startsWith('release/') ||
    lower.startsWith('doc/template/') ||
    lower.startsWith('tests/.artifacts/')
  ) {
    return true;
  }
  if (base === '.npmrc') return true;
  if (base.startsWith('.env.') && base !== '.env.example') return true;
  if (base === '.env') return true;
  if (/\.(?:jks|key|keystore|p12|pem|pfx|secret|token)$/u.test(base)) {
    return true;
  }
  return /credential.*\.json$/u.test(base);
}

function isRuntimeSource(relativePath) {
  return (
    /^(?:apps|packages)\/.*\/src\//u.test(relativePath) ||
    /^scripts\/.*\.mjs$/u.test(relativePath) ||
    /^(?:apps\/[^/]+\/)?package\.json$/u.test(relativePath)
  );
}

async function readText(relativePath) {
  try {
    const value = await readFile(path.join(rootDir, relativePath));
    if (value.includes(0)) return undefined;
    return value.toString('utf8');
  } catch (error) {
    violations.push(
      `Cannot inspect tracked file ${relativePath}: ${error.message}`,
    );
    return undefined;
  }
}

async function readRequired(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

function git(args) {
  const result = spawnGit(args);
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed.`);
  }
  return result.stdout;
}

function spawnGit(args) {
  return spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  });
}
