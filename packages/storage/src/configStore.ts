import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  actionsConfigSchema,
  appConfigSchema,
  assertValidConfigDependencies,
  endpointsConfigSchema,
  rulesConfigSchema,
  type ActionConfig,
  type AppConfig,
  type ConfigDocumentName,
  type ConfigRevision,
  type EndpointsConfig,
  type LoadedConfig,
  type RuleConfig,
} from '@las/core';
import {writeTextFileAtomically} from './atomicFile.js';
import {migrateConfigDocument} from './configMigration.js';
import {SecretStore} from './secretStore.js';

const CONFIG_NAMES: ConfigDocumentName[] = [
  'app',
  'endpoints',
  'rules',
  'actions',
];

/** Raw YAML source for every editable configuration document. */
export type RawConfigFiles = Record<ConfigDocumentName, string>;

/** Optional validation and local storage settings for a configuration store. */
export interface ConfigStoreOptions {
  validate?: (config: LoadedConfig) => void | Promise<void>;
  secretsPath?: string;
  historyPath?: string;
  historyLimit?: number;
}

interface DocumentOverride {
  source?: string;
  value?: Record<string, unknown>;
}

interface PreparedConfig {
  config: LoadedConfig;
  sources: RawConfigFiles;
  migrated: Set<ConfigDocumentName>;
}

/** Loads, validates, atomically replaces, and versions project configuration. */
export class ConfigStore {
  private operationChain = Promise.resolve();
  private readonly secretStore: SecretStore;
  private historyPath: string;
  private historyLimit: number;

  constructor(
    private readonly rootDir: string,
    private readonly options: ConfigStoreOptions = {},
  ) {
    this.secretStore = new SecretStore(
      this.resolveManagedPath(options.secretsPath ?? 'config/secrets.yaml'),
    );
    this.historyPath = this.resolveManagedPath(
      options.historyPath ?? 'data/config-history',
    );
    this.historyLimit = options.historyLimit ?? 30;
  }

  async load(): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      const prepared = await this.prepare();
      this.adoptHistorySettings(prepared.config.app);
      await this.persistMigrations(prepared);
      return prepared.config;
    });
  }

  async loadRaw(): Promise<RawConfigFiles> {
    return this.runExclusive(async () => {
      const prepared = await this.prepare();
      this.adoptHistorySettings(prepared.config.app);
      await this.persistMigrations(prepared);
      return prepared.sources;
    });
  }

  async previewRaw(
    name: ConfigDocumentName,
    content: string,
  ): Promise<LoadedConfig> {
    return this.runExclusive(
      async () => (await this.prepare({[name]: {source: content}})).config,
    );
  }

  async previewEndpoints(endpoints: EndpointsConfig): Promise<LoadedConfig> {
    const parsed = endpointsConfigSchema.parse(endpoints);
    return this.previewValue('endpoints', parsed);
  }

  async saveRaw(
    name: ConfigDocumentName,
    content: string,
  ): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      const prepared = await this.prepare({[name]: {source: content}});
      this.adoptHistorySettings(prepared.config.app);
      await this.persistMigrations(prepared, name);
      await this.writeDocument(name, prepared.sources[name], 'save');
      return prepared.config;
    });
  }

  async saveEndpoints(endpoints: EndpointsConfig): Promise<LoadedConfig> {
    return this.saveValue('endpoints', endpointsConfigSchema.parse(endpoints));
  }

  async saveRules(rules: RuleConfig[]): Promise<LoadedConfig> {
    const parsed = rulesConfigSchema.parse({version: 1, rules});
    return this.saveValue('rules', parsed);
  }

  async saveActions(actions: ActionConfig[]): Promise<LoadedConfig> {
    const parsed = actionsConfigSchema.parse({version: 1, actions});
    return this.saveValue('actions', parsed);
  }

  async saveApp(app: AppConfig): Promise<LoadedConfig> {
    return this.saveValue('app', appConfigSchema.parse(app));
  }

  async loadApp(): Promise<AppConfig> {
    return (await this.load()).app;
  }

  async loadEndpoints(): Promise<EndpointsConfig> {
    return (await this.load()).endpoints;
  }

  async loadRules(): Promise<RuleConfig[]> {
    return (await this.load()).rules;
  }

  async loadActions(): Promise<ActionConfig[]> {
    return (await this.load()).actions;
  }

  async listHistory(name?: ConfigDocumentName): Promise<ConfigRevision[]> {
    return this.runExclusive(() => this.listHistoryUnlocked(name));
  }

  async previewRevision(
    name: ConfigDocumentName,
    revisionId: string,
  ): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      assertRevisionId(revisionId);
      const revision = await this.readRevision(name, revisionId);
      return (await this.prepare({[name]: {source: revision.content}})).config;
    });
  }

  async restore(
    name: ConfigDocumentName,
    revisionId: string,
  ): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      assertRevisionId(revisionId);
      const revision = await this.readRevision(name, revisionId);
      const prepared = await this.prepare({
        [name]: {source: revision.content},
      });
      this.adoptHistorySettings(prepared.config.app);
      await this.persistMigrations(prepared, name);
      await this.writeDocument(
        name,
        prepared.sources[name],
        'restore',
        revisionId,
      );
      return prepared.config;
    });
  }

  redact<T>(value: T): T {
    return this.secretStore.redact(value);
  }

  private async previewValue(
    name: ConfigDocumentName,
    value: Record<string, unknown>,
  ): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      await this.secretStore.load();
      const protectedValue = this.secretStore.protect(value) as Record<
        string,
        unknown
      >;
      return (await this.prepare({[name]: {value: protectedValue}})).config;
    });
  }

  private async saveValue(
    name: ConfigDocumentName,
    value: Record<string, unknown>,
  ): Promise<LoadedConfig> {
    return this.runExclusive(async () => {
      await this.secretStore.load();
      const protectedValue = this.secretStore.protect(value) as Record<
        string,
        unknown
      >;
      const prepared = await this.prepare({
        [name]: {value: protectedValue},
      });
      this.adoptHistorySettings(prepared.config.app);
      await this.persistMigrations(prepared, name);
      await this.writeDocument(name, prepared.sources[name], 'save');
      return prepared.config;
    });
  }

  private async prepare(
    overrides: Partial<Record<ConfigDocumentName, DocumentOverride>> = {},
  ): Promise<PreparedConfig> {
    const secrets = await this.secretStore.load();
    const sources = {} as RawConfigFiles;
    const values = {} as Record<ConfigDocumentName, Record<string, unknown>>;
    const migrated = new Set<ConfigDocumentName>();
    for (const name of CONFIG_NAMES) {
      const override = overrides[name];
      const source =
        override?.source ??
        (override?.value
          ? YAML.stringify(override.value)
          : await this.readConfigFile(name));
      const parsed = override?.value ?? (YAML.parse(source) as unknown);
      const migration = migrateConfigDocument(name, parsed);
      values[name] = migration.value;
      sources[name] = ensureFinalNewline(
        migration.migrated || override?.value
          ? YAML.stringify(migration.value)
          : source,
      );
      if (migration.migrated) migrated.add(name);
    }
    const resolved = Object.fromEntries(
      CONFIG_NAMES.map(name => [
        name,
        this.secretStore.resolve(values[name], secrets),
      ]),
    ) as Record<ConfigDocumentName, unknown>;
    const config: LoadedConfig = {
      app: appConfigSchema.parse(resolved.app),
      endpoints: endpointsConfigSchema.parse(resolved.endpoints),
      rules: rulesConfigSchema.parse(resolved.rules).rules,
      actions: actionsConfigSchema.parse(resolved.actions).actions,
    };
    assertValidConfigDependencies(config);
    await this.options.validate?.(config);
    return {config, sources, migrated};
  }

  private async persistMigrations(
    prepared: PreparedConfig,
    exclude?: ConfigDocumentName,
  ): Promise<void> {
    for (const name of prepared.migrated) {
      if (name === exclude) continue;
      await this.writeDocument(name, prepared.sources[name], 'migration');
    }
  }

  private async writeDocument(
    name: ConfigDocumentName,
    source: string,
    reason: ConfigRevision['reason'],
    restoredFrom?: string,
  ): Promise<void> {
    const filePath = this.resolveConfig(name);
    let previous: string | undefined;
    try {
      previous = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous === source) return;
    if (previous !== undefined) {
      await this.createRevision(name, previous, reason, restoredFrom);
    }
    await writeTextFileAtomically(filePath, source);
  }

  private async createRevision(
    name: ConfigDocumentName,
    content: string,
    reason: ConfigRevision['reason'],
    restoredFrom?: string,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`;
    const revisionPath = path.join(this.historyPath, name, id);
    const normalizedContent = ensureFinalNewline(content);
    const metadata: ConfigRevision = {
      id,
      name,
      createdAt,
      reason,
      size: Buffer.byteLength(normalizedContent),
      sha256: sha256(normalizedContent),
      restoredFrom,
    };
    await mkdir(revisionPath, {recursive: true});
    await writeTextFileAtomically(
      path.join(revisionPath, 'config.yaml'),
      normalizedContent,
    );
    await writeTextFileAtomically(
      path.join(revisionPath, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    await this.pruneHistory(name);
  }

  private async listHistoryUnlocked(
    name?: ConfigDocumentName,
  ): Promise<ConfigRevision[]> {
    const names = name ? [name] : CONFIG_NAMES;
    const revisions: ConfigRevision[] = [];
    for (const documentName of names) {
      const directory = path.join(this.historyPath, documentName);
      let entries: string[];
      try {
        entries = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of entries) {
        try {
          const source = await readFile(
            path.join(directory, entry, 'metadata.json'),
            'utf8',
          );
          const metadata = JSON.parse(source) as ConfigRevision;
          if (
            metadata.id === entry &&
            metadata.name === documentName &&
            typeof metadata.createdAt === 'string'
          ) {
            revisions.push(metadata);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    return revisions.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  private async readRevision(
    name: ConfigDocumentName,
    id: string,
  ): Promise<{metadata: ConfigRevision; content: string}> {
    const revisionPath = path.join(this.historyPath, name, id);
    const [metadataSource, content] = await Promise.all([
      readFile(path.join(revisionPath, 'metadata.json'), 'utf8'),
      readFile(path.join(revisionPath, 'config.yaml'), 'utf8'),
    ]);
    const metadata = JSON.parse(metadataSource) as ConfigRevision;
    if (
      metadata.id !== id ||
      metadata.name !== name ||
      metadata.sha256 !== sha256(content)
    ) {
      throw new Error(
        `Configuration revision "${id}" failed integrity checks.`,
      );
    }
    return {metadata, content};
  }

  private async pruneHistory(name: ConfigDocumentName): Promise<void> {
    const revisions = await this.listHistoryUnlocked(name);
    for (const revision of revisions.slice(this.historyLimit)) {
      await rm(path.join(this.historyPath, name, revision.id), {
        recursive: true,
        force: true,
      });
    }
  }

  private adoptHistorySettings(app: AppConfig): void {
    this.historyPath = this.resolveManagedPath(app.storage.configHistoryPath);
    this.historyLimit = app.storage.configHistoryLimit;
  }

  private async readConfigFile(name: ConfigDocumentName): Promise<string> {
    return readFile(this.resolveConfig(name), 'utf8');
  }

  private resolveConfig(name: ConfigDocumentName): string {
    return path.join(this.rootDir, 'config', `${name}.yaml`);
  }

  private resolveManagedPath(value: string): string {
    const resolved = path.resolve(this.rootDir, value);
    const relative = path.relative(this.rootDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Managed path must stay inside the project root: ${value}`,
      );
    }
    return resolved;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Ensures the runtime data directory exists. */
export async function ensureDataDir(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, 'data'), {recursive: true});
}

function ensureFinalNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRevisionId(value: string): void {
  if (!/^[0-9TZ.-]+-[0-9a-f-]{36}$/u.test(value)) {
    throw new Error('Invalid configuration revision id.');
  }
}
