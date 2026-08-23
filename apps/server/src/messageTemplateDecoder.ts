import {readFile, readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {isIP} from 'node:net';
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import {
  firstJsonPathValue,
  messageTemplateSchema,
  type MessageTemplate,
  type MessageTemplateField,
} from '@las/core';

/** Message-template metadata returned to the WebUI. */
export interface MessageTemplateSummary {
  name: string;
  id: string;
  templateVersion: MessageTemplate['templateVersion'];
  displayName: string;
  description: string;
  contentType: MessageTemplate['contentType'];
  capabilities: MessageTemplate['capabilities'];
  minimum: MessageTemplate['minimum'];
  fields: MessageTemplate['fields'];
  constraints: MessageTemplate['constraints'];
  examples: MessageTemplate['examples'];
  notes: MessageTemplate['notes'];
}

/** Validation and field-extraction result for one message body. */
export interface MessageTemplateDecodeResult {
  template: string;
  templateId?: string;
  matched: boolean;
  displayItems?: Array<{
    label: string;
    path: string;
    value: unknown;
  }>;
  values?: Record<string, unknown>;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  error?: string;
}

interface LoadedMessageTemplate {
  content: string;
  template: MessageTemplate;
  validate: ValidateFunction;
}

/** Loads v2 templates and validates, decodes, or materializes messages. */
export class MessageTemplateDecoder {
  private readonly ajv = createTemplateAjv();
  private readonly templatesDir: string;
  private readonly cache = new Map<string, LoadedMessageTemplate>();
  private readonly pendingLoads = new Map<
    string,
    Promise<LoadedMessageTemplate>
  >();

  constructor(rootDir: string) {
    this.templatesDir = path.join(rootDir, 'config', 'templates');
  }

  async list(): Promise<MessageTemplateSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.templatesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const names = entries
      .filter(name => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    this.pruneCache(new Set(names));
    return Promise.all(
      names.map(async name => {
        const {template} = await this.load(name);
        return {
          name,
          id: template.id,
          templateVersion: template.templateVersion,
          displayName: template.name,
          description: template.description,
          contentType: template.contentType,
          capabilities: template.capabilities,
          minimum: template.minimum,
          fields: template.fields,
          constraints: template.constraints,
          examples: template.examples,
          notes: template.notes,
        };
      }),
    );
  }

  async decode(
    name: string,
    body: unknown,
  ): Promise<MessageTemplateDecodeResult> {
    try {
      const {template, validate} = await this.load(name);
      if (!template.capabilities.receive) {
        throw new Error(`Message template does not support receiving: ${name}`);
      }
      if (!validate(body)) {
        return {
          template: name,
          templateId: template.id,
          matched: false,
          errors: simplifyErrors(validate.errors),
        };
      }
      const extracted = template.fields.map(field => {
        const {path, value} = firstDisplayItemValue(
          body,
          field.path,
          field.paths,
        );
        return {field, path, value};
      });
      return {
        template: name,
        templateId: template.id,
        matched: true,
        values: Object.fromEntries(
          extracted
            .filter(({field}) => field.roles.match)
            .map(({field, value}) => [field.key, value]),
        ),
        displayItems: extracted
          .filter(({field, value}) =>
            Boolean(field.roles.display && hasMeaningfulValue(value)),
          )
          .sort(
            (left, right) =>
              (left.field.displayOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.field.displayOrder ?? Number.MAX_SAFE_INTEGER),
          )
          .map(({field, path, value}) => {
            return {
              label: field.label,
              path,
              value,
            };
          }),
      };
    } catch (error) {
      return {
        template: name,
        matched: false,
        error: (error as Error).message,
      };
    }
  }

  async materialize(
    name: string,
    values: Record<string, unknown> = {},
    includedPaths?: string[],
  ): Promise<unknown> {
    const {template, validate} = await this.load(name);
    if (!template.capabilities.send) {
      throw new Error(`Message template does not support sending: ${name}`);
    }
    const body = cloneTemplateExample(template.minimum.body);
    const allSendFields = template.fields.filter(field => field.roles.send);
    const included = includedPaths ? new Set(includedPaths) : undefined;
    const sendFields = included
      ? allSendFields.filter(
          field => field.required || included.has(field.path),
        )
      : allSendFields;
    const fieldsByPath = new Map(sendFields.map(field => [field.path, field]));
    for (const field of sendFields) {
      if (field.generatedValue !== undefined) {
        setSimpleJsonPathValue(
          body,
          field.path,
          generateTemplateValue(field.generatedValue),
        );
      } else if (field.defaultValue !== undefined) {
        setSimpleJsonPathValue(body, field.path, field.defaultValue);
      }
    }
    const providedValues = Object.entries(values).sort(
      ([left], [right]) =>
        parseSimpleJsonPath(left).length - parseSimpleJsonPath(right).length,
    );
    for (const [jsonPath, value] of providedValues) {
      if (isBlankTemplateValue(value)) continue;
      const field = fieldsByPath.get(jsonPath);
      if (!field)
        throw new Error(`Template field is not sendable: ${jsonPath}`);
      const coerced = coerceTemplateValue(value, field);
      assertTemplateFieldValue(field, coerced);
      setSimpleJsonPathValue(body, jsonPath, coerced);
    }
    const result = template.minimum.pruneEmpty ? pruneEmptyValues(body) : body;
    for (const field of allSendFields.filter(item => item.required)) {
      if (firstJsonPathValue(result, field.path) === undefined) {
        throw new Error(
          `Required template field is missing: ${field.label} (${field.path})`,
        );
      }
    }
    for (const requirement of template.constraints) {
      if (
        !requirement.paths.some(pathValue =>
          hasMeaningfulValue(firstJsonPathValue(result, pathValue)),
        )
      ) {
        throw new Error(requirement.message);
      }
    }
    if (!validate(result)) {
      const details = simplifyErrors(validate.errors)
        .map(error => `${error.path}: ${error.message}`)
        .join('; ');
      throw new Error(
        `Materialized message does not match template ${name}: ${details}`,
      );
    }
    return result;
  }

  private async load(name: string): Promise<LoadedMessageTemplate> {
    if (path.basename(name) !== name || !name.endsWith('.json')) {
      throw new Error(`Invalid message template name: ${name}`);
    }

    const pending = this.pendingLoads.get(name);
    if (pending) return pending;

    const load = this.readAndCompile(name);
    this.pendingLoads.set(name, load);
    try {
      return await load;
    } finally {
      if (this.pendingLoads.get(name) === load) {
        this.pendingLoads.delete(name);
      }
    }
  }

  private async readAndCompile(name: string): Promise<LoadedMessageTemplate> {
    let content: string;
    try {
      content = await readFile(path.join(this.templatesDir, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.releaseCached(name);
      }
      throw error;
    }

    const cached = this.cache.get(name);
    if (cached?.content === content) return cached;

    const template = messageTemplateSchema.parse(
      JSON.parse(content),
    ) as MessageTemplate;
    this.releaseCached(name);
    let validate: ValidateFunction;
    try {
      validate = this.ajv.compile(template.schema);
      this.assertDefinition(name, template, validate);
    } catch (error) {
      this.ajv.removeSchema(template.schema);
      throw error;
    }
    const loaded = {content, template, validate};
    this.cache.set(name, loaded);
    return loaded;
  }

  private assertDefinition(
    name: string,
    template: MessageTemplate,
    validate: ValidateFunction,
  ): void {
    for (const field of template.fields) {
      if (field.defaultValue !== undefined)
        assertTemplateFieldValue(field, field.defaultValue);
    }
    for (const example of template.examples) {
      if (!validate(example.body)) {
        const details = simplifyErrors(validate.errors)
          .map(error => `${error.path}: ${error.message}`)
          .join('; ');
        throw new Error(
          `Invalid example "${example.name}" in template ${name}: ${details}`,
        );
      }
    }
    if (
      template.capabilities.send &&
      !template.fields.some(field => field.roles.send)
    ) {
      throw new Error(`Send-capable template has no sendable fields: ${name}`);
    }
    if (
      template.capabilities.match &&
      !template.fields.some(field => field.roles.match)
    ) {
      throw new Error(
        `Match-capable template has no matchable fields: ${name}`,
      );
    }
  }

  private pruneCache(names: Set<string>): void {
    for (const name of this.cache.keys()) {
      if (!names.has(name)) this.releaseCached(name);
    }
  }

  private releaseCached(name: string): void {
    const cached = this.cache.get(name);
    if (!cached) return;
    this.ajv.removeSchema(cached.template.schema);
    this.cache.delete(name);
  }
}

function generateTemplateValue(
  generator: NonNullable<MessageTemplateField['generatedValue']>,
): string {
  if (generator === 'uuid') return randomUUID();
  return new Date().toISOString();
}

function createTemplateAjv(): Ajv2020 {
  const ajv = new Ajv2020({allErrors: true, strict: false});
  ajv.addFormat(
    'date-time',
    value =>
      /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)),
  );
  ajv.addFormat('uri', value => {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
  ajv.addFormat('ipv4', value => isIP(value) === 4);
  ajv.addFormat('ipv6', value => isIP(value) === 6);
  return ajv;
}

function cloneTemplateExample(example: unknown): unknown {
  if (example === undefined) return {};
  return JSON.parse(JSON.stringify(example));
}

function setSimpleJsonPathValue(
  target: unknown,
  pathValue: string,
  value: unknown,
): void {
  const segments = parseSimpleJsonPath(pathValue);
  if (!isRecord(target) || segments.length === 0) return;

  let current: Record<string, unknown> | unknown[] = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return;
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        current[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      current = current[segment] as Record<string, unknown> | unknown[];
      continue;
    }

    if (!isRecord(current)) return;
    if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
      current[segment] = typeof nextSegment === 'number' ? [] : {};
    }
    current = current[segment] as Record<string, unknown> | unknown[];
  }

  const last = segments.at(-1);
  if (typeof last === 'number') {
    if (Array.isArray(current))
      current[last] = mergeTemplateValue(current[last], value);
  } else if (last && isRecord(current)) {
    current[last] = mergeTemplateValue(current[last], value);
  }
}

function mergeTemplateValue(existing: unknown, value: unknown): unknown {
  const coerced = coerceTemplateValue(value);
  if (isRecord(existing) && isRecord(coerced)) {
    return {...existing, ...coerced};
  }
  return coerced;
}

function parseSimpleJsonPath(pathValue: string): Array<string | number> {
  if (!pathValue.startsWith('$.')) return [];
  const segments: Array<string | number> = [];
  const pattern = /([A-Za-z_$][\w$-]*)|\[(\d+)\]/g;
  for (const match of pathValue.slice(2).matchAll(pattern)) {
    if (match[1]) segments.push(match[1]);
    if (match[2]) segments.push(Number(match[2]));
  }
  return segments;
}

function coerceTemplateValue(
  value: unknown,
  field?: MessageTemplateField,
): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (field?.valueType === 'number' || field?.valueType === 'integer') {
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : value;
  }
  if (
    field?.valueType === 'boolean' &&
    (trimmed === 'true' || trimmed === 'false')
  ) {
    return trimmed === 'true';
  }
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function assertTemplateFieldValue(
  field: MessageTemplateField,
  value: unknown,
): void {
  const actualType = Array.isArray(value)
    ? 'array'
    : value === null
      ? 'null'
      : typeof value;
  const typeMatches =
    field.valueType === 'integer'
      ? typeof value === 'number' && Number.isInteger(value)
      : actualType === field.valueType;
  if (!typeMatches) {
    throw new Error(`${field.label} must be ${field.valueType}.`);
  }
  if (
    field.allowedValues &&
    !field.allowedValues.some(
      allowed => JSON.stringify(allowed) === JSON.stringify(value),
    )
  ) {
    throw new Error(
      `${field.label} must be one of: ${field.allowedValues.map(String).join(', ')}.`,
    );
  }
  if (
    field.constValue !== undefined &&
    JSON.stringify(field.constValue) !== JSON.stringify(value)
  ) {
    throw new Error(`${field.label} must equal ${String(field.constValue)}.`);
  }
  if (typeof value === 'number') {
    if (field.minimum !== undefined && value < field.minimum)
      throw new Error(`${field.label} must be at least ${field.minimum}.`);
    if (field.maximum !== undefined && value > field.maximum)
      throw new Error(`${field.label} must be at most ${field.maximum}.`);
  }
  if (typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength)
      throw new Error(`${field.label} is too short.`);
    if (field.maxLength !== undefined && value.length > field.maxLength)
      throw new Error(`${field.label} is too long.`);
    if (field.pattern && !new RegExp(field.pattern).test(value))
      throw new Error(`${field.label} has an invalid format.`);
  }
  if (Array.isArray(value)) {
    if (field.minItems !== undefined && value.length < field.minItems)
      throw new Error(`${field.label} has too few items.`);
    if (field.maxItems !== undefined && value.length > field.maxItems)
      throw new Error(`${field.label} has too many items.`);
  }
}

function isBlankTemplateValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
  return true;
}

function pruneEmptyValues(value: unknown, isRoot = true): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map(item => pruneEmptyValues(item, false))
      .filter(item => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, pruneEmptyValues(item, false)] as const)
      .filter(([, item]) => item !== undefined);
    if (entries.length === 0 && !isRoot) return undefined;
    return Object.fromEntries(entries);
  }
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDisplayItemValue(
  body: unknown,
  path: string,
  paths: string[] | undefined,
): {path: string; value: unknown} {
  let firstDefined: {path: string; value: unknown} | undefined;
  for (const candidate of [path, ...(paths ?? [])]) {
    const value = firstJsonPathValue(body, candidate);
    if (value !== undefined) {
      firstDefined ??= {path: candidate, value};
      if (hasMeaningfulValue(value)) return {path: candidate, value};
    }
  }
  return firstDefined ?? {path, value: undefined};
}

function simplifyErrors(
  errors: ErrorObject[] | null | undefined,
): Array<{path: string; message: string}> {
  return (errors ?? []).map(error => ({
    path: error.instancePath || '/',
    message: error.message ?? 'Invalid value.',
  }));
}
