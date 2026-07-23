import {readFile} from 'node:fs/promises';
import YAML from 'yaml';

const SECRET_REFERENCE = /\$\{secret:([A-Za-z][A-Za-z0-9_.-]*)\}/gu;
const ENV_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gu;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|private.?key|secret|token|api.?key)/iu;

/** Loads a local secret map and resolves explicit secret/environment references. */
export class SecretStore {
  private knownValues = new Map<string, string>();

  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, string>> {
    let source: string;
    try {
      source = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.knownValues = new Map();
        return {};
      }
      throw error;
    }
    const parsed = YAML.parse(source) as unknown;
    if (!isRecord(parsed) || (parsed.version ?? 1) !== 1) {
      throw new Error('secrets.yaml must be a version 1 YAML object.');
    }
    const rawSecrets = parsed.secrets;
    if (!isRecord(rawSecrets)) {
      throw new Error('secrets.yaml requires a secrets object.');
    }
    const secrets: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawSecrets)) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Secret "${name}" must be a non-empty string.`);
      }
      secrets[name] = value;
    }
    this.knownValues = new Map(Object.entries(secrets));
    return secrets;
  }

  resolve(value: unknown, secrets: Record<string, string>): unknown {
    return mapValue(value, (text, key) => {
      const withSecrets = text.replace(SECRET_REFERENCE, (_match, name) => {
        const resolved = secrets[name];
        if (resolved === undefined) {
          throw new Error(
            `Missing secret "${name}" referenced at ${key || '<root>'}.`,
          );
        }
        return resolved;
      });
      return withSecrets.replace(ENV_REFERENCE, (_match, name) => {
        const resolved = process.env[name];
        if (resolved === undefined) {
          throw new Error(
            `Missing environment variable "${name}" referenced at ${key || '<root>'}.`,
          );
        }
        this.knownValues.set(`env:${name}`, resolved);
        return resolved;
      });
    });
  }

  protect(value: unknown): unknown {
    const secrets = [...this.knownValues.entries()].sort(
      (left, right) => right[1].length - left[1].length,
    );
    return mapValue(value, text => {
      for (const [name, secret] of secrets) {
        const reference = name.startsWith('env:')
          ? `\${env:${name.slice(4)}}`
          : `\${secret:${name}}`;
        if (text === secret) return reference;
        if (secret.length >= 8 && text.includes(secret)) {
          text = text.replaceAll(secret, reference);
        }
      }
      return text;
    });
  }

  redact<T>(value: T): T {
    const secrets = [...this.knownValues.values()]
      .filter(secret => secret.length >= 4)
      .sort((left, right) => right.length - left.length);
    return redactValue(value, '', secrets) as T;
  }
}

function mapValue(
  value: unknown,
  mapString: (value: string, path: string) => string,
  currentPath = '',
): unknown {
  if (typeof value === 'string') return mapString(value, currentPath);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      mapValue(item, mapString, `${currentPath}[${index}]`),
    );
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      mapValue(item, mapString, currentPath ? `${currentPath}.${key}` : key),
    ]),
  );
}

function redactValue(value: unknown, key: string, secrets: string[]): unknown {
  if (SENSITIVE_KEY.test(key) && value !== undefined) return REDACTED;
  if (typeof value === 'string') {
    let redacted = value;
    for (const secret of secrets)
      redacted = redacted.replaceAll(secret, REDACTED);
    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, key, secrets));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, item]) => [
      entryKey,
      redactValue(item, entryKey, secrets),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
