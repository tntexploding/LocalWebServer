import type {
  WorkflowExpressionContext,
  WorkflowExpressionMissingPolicy,
} from './types.js';

const EXPRESSION_PATTERN = /\$\{\{\s*([^{}]+?)\s*\}\}/gu;
const EXACT_EXPRESSION_PATTERN = /^\s*\$\{\{\s*([^{}]+?)\s*\}\}\s*$/u;
const ALLOWED_ROOTS = new Set([
  'trigger',
  'inputs',
  'nodes',
  'last',
  'workflow',
]);

export interface WorkflowExpressionDiagnostic {
  expression: string;
  path: string;
  found: boolean;
  value?: unknown;
  fallback?: unknown;
  error?: string;
}

export interface WorkflowExpressionOptions {
  onMissing?: WorkflowExpressionMissingPolicy;
}

/** Returns true when a string contains at least one workflow expression. */
export function containsWorkflowExpression(value: string): boolean {
  EXPRESSION_PATTERN.lastIndex = 0;
  const found = EXPRESSION_PATTERN.test(value);
  EXPRESSION_PATTERN.lastIndex = 0;
  return found;
}

/** Resolves safe workflow expressions recursively without evaluating code. */
export function resolveWorkflowExpressions<T>(
  value: T,
  context: WorkflowExpressionContext,
  options: WorkflowExpressionOptions = {},
): T {
  return resolveValue(value, context, options.onMissing ?? 'error') as T;
}

/** Inspects every expression and reports missing values or invalid syntax. */
export function inspectWorkflowExpressions(
  value: unknown,
  context: WorkflowExpressionContext,
): WorkflowExpressionDiagnostic[] {
  const diagnostics: WorkflowExpressionDiagnostic[] = [];
  visitStrings(value, text => {
    EXPRESSION_PATTERN.lastIndex = 0;
    const matches = [...text.matchAll(EXPRESSION_PATTERN)];
    if (hasMalformedDelimiters(text, matches)) {
      diagnostics.push({
        expression: text,
        path: '',
        found: false,
        error: 'Malformed workflow expression delimiter.',
      });
      return;
    }
    for (const match of matches) {
      diagnostics.push(inspectExpression(match[1] ?? '', context));
    }
  });
  return diagnostics;
}

/** Validates expression syntax without requiring runtime values. */
export function validateWorkflowExpressionSyntax(value: unknown): string[] {
  const errors: string[] = [];
  visitStrings(value, text => {
    EXPRESSION_PATTERN.lastIndex = 0;
    const matches = [...text.matchAll(EXPRESSION_PATTERN)];
    if (hasMalformedDelimiters(text, matches)) {
      errors.push(`Malformed workflow expression: ${text}`);
      return;
    }
    for (const match of matches) {
      try {
        parseExpression(match[1] ?? '');
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  });
  return errors;
}

function resolveValue(
  value: unknown,
  context: WorkflowExpressionContext,
  onMissing: WorkflowExpressionMissingPolicy,
): unknown {
  if (typeof value === 'string') {
    return resolveString(value, context, onMissing);
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, context, onMissing));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveValue(item, context, onMissing),
      ]),
    );
  }
  return value;
}

function resolveString(
  value: string,
  context: WorkflowExpressionContext,
  onMissing: WorkflowExpressionMissingPolicy,
): unknown {
  EXPRESSION_PATTERN.lastIndex = 0;
  const matches = [...value.matchAll(EXPRESSION_PATTERN)];
  if (hasMalformedDelimiters(value, matches)) {
    throw new Error(`Malformed workflow expression: ${value}`);
  }
  if (matches.length === 0) return value;
  const exact = value.match(EXACT_EXPRESSION_PATTERN);
  if (exact) {
    return resolveExpression(exact[1] ?? '', context, onMissing, value);
  }
  EXPRESSION_PATTERN.lastIndex = 0;
  return value.replace(EXPRESSION_PATTERN, (source, expression: string) =>
    stringifyInterpolated(
      resolveExpression(expression, context, onMissing, source),
    ),
  );
}

function resolveExpression(
  expression: string,
  context: WorkflowExpressionContext,
  onMissing: WorkflowExpressionMissingPolicy,
  source: string,
): unknown {
  const parsed = parseExpression(expression);
  const value = selectValue(context, parsed.segments);
  if (value !== undefined) return value;
  if (parsed.hasFallback) return parsed.fallback;
  if (onMissing === 'empty') return '';
  if (onMissing === 'preserve') return source;
  throw new Error(`Workflow expression value is missing: ${parsed.path}`);
}

function inspectExpression(
  expression: string,
  context: WorkflowExpressionContext,
): WorkflowExpressionDiagnostic {
  try {
    const parsed = parseExpression(expression);
    const value = selectValue(context, parsed.segments);
    return {
      expression,
      path: parsed.path,
      found: value !== undefined,
      value,
      ...(parsed.hasFallback ? {fallback: parsed.fallback} : {}),
    };
  } catch (error) {
    return {
      expression,
      path: '',
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseExpression(expression: string): {
  path: string;
  segments: Array<string | number>;
  hasFallback: boolean;
  fallback?: unknown;
} {
  const [pathSource, fallbackSource] = splitFallback(expression);
  const path = pathSource.trim();
  if (!path) throw new Error('Workflow expression path cannot be empty.');
  const segments = parseSafePath(path);
  const root = segments[0];
  if (typeof root !== 'string' || !ALLOWED_ROOTS.has(root)) {
    throw new Error(
      `Unsupported workflow expression root: ${String(root ?? path)}`,
    );
  }
  if (fallbackSource === undefined) {
    return {path, segments, hasFallback: false};
  }
  try {
    return {
      path,
      segments,
      hasFallback: true,
      fallback: JSON.parse(fallbackSource.trim()),
    };
  } catch {
    throw new Error(
      `Workflow expression fallback must be valid JSON: ${fallbackSource.trim()}`,
    );
  }
}

function splitFallback(expression: string): [string, string?] {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < expression.length - 1; index += 1) {
    const character = expression[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '?' && expression[index + 1] === '?') {
      return [expression.slice(0, index), expression.slice(index + 2)];
    }
  }
  return [expression];
}

function selectValue(
  context: WorkflowExpressionContext,
  segments: Array<string | number>,
): unknown {
  let current: unknown = context;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length)
        return undefined;
      current = current[segment];
      continue;
    }
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseSafePath(path: string): Array<string | number> {
  const source = path.trim();
  const segments: Array<string | number> = [];
  let index = 0;
  if (source[index] === '$') {
    index += 1;
    if (source[index] === '.') index += 1;
  }

  const first = readIdentifier(source, index);
  if (!first) throw invalidPath(path);
  segments.push(first.value);
  index = first.next;

  while (index < source.length) {
    if (source[index] === '.') {
      const identifier = readIdentifier(source, index + 1);
      if (!identifier) throw invalidPath(path);
      segments.push(identifier.value);
      index = identifier.next;
      continue;
    }
    if (source[index] === '[') {
      const bracket = readBracketSegment(source, index);
      segments.push(bracket.value);
      index = bracket.next;
      continue;
    }
    throw invalidPath(path);
  }
  return segments;
}

function readIdentifier(
  source: string,
  start: number,
): {value: string; next: number} | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(start));
  return match ? {value: match[0], next: start + match[0].length} : undefined;
}

function readBracketSegment(
  source: string,
  start: number,
): {value: string | number; next: number} {
  let index = skipSpaces(source, start + 1);
  const number = /^\d+/u.exec(source.slice(index));
  if (number) {
    index = skipSpaces(source, index + number[0].length);
    if (source[index] !== ']') throw invalidPath(source);
    return {value: Number(number[0]), next: index + 1};
  }

  const quote = source[index];
  if (quote !== '"' && quote !== "'") throw invalidPath(source);
  const key = readQuotedKey(source, index, quote);
  index = skipSpaces(source, key.next);
  if (source[index] !== ']') throw invalidPath(source);
  return {value: key.value, next: index + 1};
}

function readQuotedKey(
  source: string,
  start: number,
  quote: string,
): {value: string; next: number} {
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return {value, next: index + 1};
    if (character !== '\\') {
      value += character;
      continue;
    }
    const escaped = source[index + 1];
    if (!escaped) throw invalidPath(source);
    if (escaped === 'u') {
      const codePoint = source.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/iu.test(codePoint)) throw invalidPath(source);
      value += String.fromCharCode(Number.parseInt(codePoint, 16));
      index += 5;
      continue;
    }
    const escapes: Record<string, string> = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      '\\': '\\',
      '"': '"',
      "'": "'",
    };
    if (!(escaped in escapes)) throw invalidPath(source);
    value += escapes[escaped];
    index += 1;
  }
  throw invalidPath(source);
}

function skipSpaces(source: string, start: number): number {
  let index = start;
  while (/\s/u.test(source[index] ?? '')) index += 1;
  return index;
}

function invalidPath(path: string): Error {
  return new Error(
    `Invalid workflow expression path "${path}". Only properties, numeric indexes, and quoted keys are allowed.`,
  );
}

function stringifyInterpolated(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function hasMalformedDelimiters(
  value: string,
  matches: RegExpMatchArray[],
): boolean {
  if (!value.includes('${{')) return false;
  const stripped = matches.reduce(
    (text, match) => text.replace(match[0], ''),
    value,
  );
  return stripped.includes('${{') || stripped.includes('}}');
}

function visitStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) visitStrings(item, visit);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
