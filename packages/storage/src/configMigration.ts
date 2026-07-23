import type {ConfigDocumentName} from '@las/core';

/** Version written to all configuration documents after migration. */
export const CURRENT_CONFIG_VERSION = 1;

export interface ConfigMigrationResult {
  value: Record<string, unknown>;
  migrated: boolean;
}

/** Upgrades a parsed configuration document without resolving its secrets. */
export function migrateConfigDocument(
  name: ConfigDocumentName,
  value: unknown,
): ConfigMigrationResult {
  if (!isRecord(value)) {
    throw new Error(`${name}.yaml must contain a YAML object.`);
  }
  const version = value.version;
  if (version === CURRENT_CONFIG_VERSION) {
    return {value, migrated: false};
  }
  if (version === undefined || version === 0) {
    return {
      value: {...value, version: CURRENT_CONFIG_VERSION},
      migrated: true,
    };
  }
  throw new Error(
    `${name}.yaml uses unsupported config version ${String(version)}; current version is ${CURRENT_CONFIG_VERSION}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
