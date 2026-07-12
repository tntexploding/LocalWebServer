import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  actionsConfigSchema,
  appConfigSchema,
  endpointsConfigSchema,
  rulesConfigSchema,
  type ActionConfig,
  type AppConfig,
  type EndpointsConfig,
  type LoadedConfig,
  type RuleConfig,
} from '@las/core';

/** Raw YAML source for every editable configuration document. */
export interface RawConfigFiles {
  app: string;
  endpoints: string;
  rules: string;
  actions: string;
}

/** Loads, validates, and replaces project configuration files. */
export class ConfigStore {
  constructor(private readonly rootDir: string) {}

  async load(): Promise<LoadedConfig> {
    const [app, endpoints, rules, actions] = await Promise.all([
      this.loadApp(),
      this.loadEndpoints(),
      this.loadRules(),
      this.loadActions(),
    ]);
    return {app, endpoints, rules, actions};
  }

  async loadRaw(): Promise<RawConfigFiles> {
    const [app, endpoints, rules, actions] = await Promise.all([
      this.readConfigFile('app.yaml'),
      this.readConfigFile('endpoints.yaml'),
      this.readConfigFile('rules.yaml'),
      this.readConfigFile('actions.yaml'),
    ]);
    return {app, endpoints, rules, actions};
  }

  async saveRaw(
    name: keyof RawConfigFiles,
    content: string,
  ): Promise<LoadedConfig> {
    const fileName = `${name}.yaml`;
    this.validateRaw(name, YAML.parse(content));
    await writeFile(this.resolveConfig(fileName), content, 'utf8');
    return this.load();
  }

  async saveEndpoints(endpoints: EndpointsConfig): Promise<LoadedConfig> {
    const parsed = endpointsConfigSchema.parse(endpoints);
    return this.saveYaml('endpoints.yaml', parsed);
  }

  async saveRules(rules: RuleConfig[]): Promise<LoadedConfig> {
    const parsed = rulesConfigSchema.parse({rules});
    return this.saveYaml('rules.yaml', parsed);
  }

  async saveActions(actions: ActionConfig[]): Promise<LoadedConfig> {
    const parsed = actionsConfigSchema.parse({actions});
    return this.saveYaml('actions.yaml', parsed);
  }

  async saveApp(app: AppConfig): Promise<LoadedConfig> {
    const parsed = appConfigSchema.parse(app);
    return this.saveYaml('app.yaml', parsed);
  }

  async loadApp(): Promise<AppConfig> {
    const parsed = await this.loadYaml('app.yaml');
    return appConfigSchema.parse(parsed);
  }

  async loadEndpoints(): Promise<EndpointsConfig> {
    const parsed = await this.loadYaml('endpoints.yaml');
    return endpointsConfigSchema.parse(parsed);
  }

  async loadRules(): Promise<RuleConfig[]> {
    const parsed = await this.loadYaml('rules.yaml');
    return rulesConfigSchema.parse(parsed).rules;
  }

  async loadActions(): Promise<ActionConfig[]> {
    const parsed = await this.loadYaml('actions.yaml');
    return actionsConfigSchema.parse(parsed).actions;
  }

  private async loadYaml(fileName: string): Promise<unknown> {
    return YAML.parse(await this.readConfigFile(fileName));
  }

  private async readConfigFile(fileName: string): Promise<string> {
    return readFile(this.resolveConfig(fileName), 'utf8');
  }

  private resolveConfig(fileName: string): string {
    return path.join(this.rootDir, 'config', fileName);
  }

  private async saveYaml(
    fileName: string,
    value: unknown,
  ): Promise<LoadedConfig> {
    await writeFile(
      this.resolveConfig(fileName),
      YAML.stringify(value),
      'utf8',
    );
    return this.load();
  }

  private validateRaw(name: keyof RawConfigFiles, parsed: unknown): void {
    switch (name) {
      case 'app':
        appConfigSchema.parse(parsed);
        break;
      case 'endpoints':
        endpointsConfigSchema.parse(parsed);
        break;
      case 'rules':
        rulesConfigSchema.parse(parsed);
        break;
      case 'actions':
        actionsConfigSchema.parse(parsed);
        break;
    }
  }
}

/** Ensures the runtime data directory exists. */
export async function ensureDataDir(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, 'data'), {recursive: true});
}
