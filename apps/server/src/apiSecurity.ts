import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import type {AppConfig, SecurityAuditRecord} from '@las/core';

export type ApiPermission = 'read' | 'operate' | 'admin';
export type ApiRole = 'reader' | 'operator' | 'admin';

export interface ApiAuthorization {
  allowed: boolean;
  role?: ApiRole;
  statusCode: 200 | 401 | 403;
  reason?: string;
}

export interface SecurityAuditInput {
  requestId: string;
  remoteAddress: string;
  method: string;
  path: string;
  permission: ApiPermission;
  outcome: SecurityAuditRecord['outcome'];
  statusCode: number;
  role?: ApiRole;
  reason?: string;
}

interface AuditSink {
  append(record: SecurityAuditRecord): Promise<void>;
}

/** Applies source, origin, role, and audit policy for the control API. */
export class ApiSecurity {
  constructor(
    private readonly getConfig: () => AppConfig['security'],
    private readonly auditSink: AuditSink,
    private readonly onAuditError?: (error: unknown) => void,
  ) {}

  authorize(
    token: string | string[] | undefined,
    permission: ApiPermission,
  ): ApiAuthorization {
    const supplied = Array.isArray(token) ? token[0] : token;
    const config = this.getConfig();
    const role = supplied ? resolveRole(supplied, config) : undefined;
    if (permission === 'read' && !config.requireTokenForRead) {
      return {allowed: true, role: role ?? 'reader', statusCode: 200};
    }
    if (!role) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'A valid x-las-token is required.',
      };
    }
    if (roleRank(role) < permissionRank(permission)) {
      return {
        allowed: false,
        role,
        statusCode: 403,
        reason: `The ${role} token cannot perform ${permission} operations.`,
      };
    }
    return {allowed: true, role, statusCode: 200};
  }

  isSourceAllowed(remoteAddress: string): boolean {
    return this.getConfig().allowedApiSources.some(rule =>
      addressMatchesRule(remoteAddress, rule),
    );
  }

  isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    return this.getConfig().corsOrigins.includes(origin);
  }

  async audit(input: SecurityAuditInput): Promise<void> {
    const record: SecurityAuditRecord = {
      id: randomUUID(),
      time: new Date().toISOString(),
      ...input,
    };
    try {
      await this.auditSink.append(record);
    } catch (error) {
      this.onAuditError?.(error);
    }
  }
}

/** Matches exact IPv4/IPv6 values, CIDR ranges, loopback, or explicit '*'. */
export function addressMatchesRule(address: string, rule: string): boolean {
  const normalizedAddress = normalizeAddress(address);
  const normalizedRule = normalizeAddress(rule.trim());
  if (normalizedRule === '*') return true;
  if (normalizedRule.toLowerCase() === 'loopback') {
    return normalizedAddress === '127.0.0.1' || normalizedAddress === '::1';
  }
  const separator = normalizedRule.lastIndexOf('/');
  if (separator < 0) return normalizedAddress === normalizedRule;
  const network = normalizedRule.slice(0, separator);
  const prefix = Number(normalizedRule.slice(separator + 1));
  const parsedAddress = parseIp(normalizedAddress);
  const parsedNetwork = parseIp(network);
  if (
    !parsedAddress ||
    !parsedNetwork ||
    parsedAddress.bits !== parsedNetwork.bits ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > parsedAddress.bits
  ) {
    return false;
  }
  const shift = BigInt(parsedAddress.bits - prefix);
  return parsedAddress.value >> shift === parsedNetwork.value >> shift;
}

function resolveRole(
  supplied: string,
  config: AppConfig['security'],
): ApiRole | undefined {
  if (tokensEqual(supplied, config.apiToken)) return 'admin';
  if (config.operatorToken && tokensEqual(supplied, config.operatorToken)) {
    return 'operator';
  }
  if (config.readToken && tokensEqual(supplied, config.readToken)) {
    return 'reader';
  }
  return undefined;
}

function tokensEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function roleRank(role: ApiRole): number {
  return role === 'admin' ? 3 : role === 'operator' ? 2 : 1;
}

function permissionRank(permission: ApiPermission): number {
  return permission === 'admin' ? 3 : permission === 'operate' ? 2 : 1;
}

function normalizeAddress(value: string): string {
  const withoutZone = value.split('%', 1)[0].toLowerCase();
  return withoutZone.startsWith('::ffff:')
    ? withoutZone.slice('::ffff:'.length)
    : withoutZone;
}

function parseIp(value: string): {value: bigint; bits: 32 | 128} | undefined {
  const version = isIP(value);
  if (version === 4) return {value: parseIpv4(value), bits: 32};
  if (version === 6) return {value: parseIpv6(value), bits: 128};
  return undefined;
}

function parseIpv4(value: string): bigint {
  return value
    .split('.')
    .map(Number)
    .reduce((result, part) => (result << 8n) | BigInt(part), 0n);
}

function parseIpv6(value: string): bigint {
  let normalized = value;
  const ipv4Index = normalized.lastIndexOf(':');
  if (normalized.includes('.') && ipv4Index >= 0) {
    const ipv4 = parseIpv4(normalized.slice(ipv4Index + 1));
    normalized = `${normalized.slice(0, ipv4Index)}:${(
      (ipv4 >> 16n) &
      0xffffn
    ).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  const [leftSource, rightSource = ''] = normalized.split('::');
  const left = leftSource ? leftSource.split(':') : [];
  const right = rightSource ? rightSource.split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  return groups.reduce(
    (result, group) => (result << 16n) | BigInt(`0x${group || '0'}`),
    0n,
  );
}
