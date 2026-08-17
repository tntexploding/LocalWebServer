import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import type {AppConfig} from '@las/core';
import {addressMatchesRule, isAddressRule} from './apiSecurity.js';

const RESTRICTED_ADDRESS_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  '100::/64',
  '2001:db8::/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

type NetworkConfig = AppConfig['network'];
type OutboundConfig = NetworkConfig['outbound'];
type HostResolver = (
  hostname: string,
) => Promise<Array<{address: string; family: number}>>;

/** A caller-supplied network target or policy failed validation. */
export class NetworkPolicyError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'NetworkPolicyError';
  }
}

/** Enforces configured trust boundaries for inbound and outbound traffic. */
export class NetworkPolicy {
  constructor(
    private readonly getConfig: () => NetworkConfig,
    private readonly resolveHost: HostResolver = hostname =>
      lookup(hostname, {all: true, verbatim: true}),
  ) {}

  isInboundSourceAllowed(address: string | undefined): boolean {
    if (!address) return false;
    return this.getConfig().inbound.allowedSources.some(rule =>
      addressMatchesRule(address, rule),
    );
  }

  isInboundOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    return this.getConfig().inbound.allowedOrigins.includes(origin);
  }

  inboundLimits(): Readonly<NetworkConfig['inbound']> {
    return this.getConfig().inbound;
  }

  outboundLimits(): Readonly<NetworkConfig['outbound']> {
    return this.getConfig().outbound;
  }

  async assertHttpUrl(value: string): Promise<URL> {
    return this.assertOutboundUrl(value, ['http:', 'https:']);
  }

  async assertWebSocketUrl(value: string): Promise<URL> {
    return this.assertOutboundUrl(value, ['ws:', 'wss:']);
  }

  async assertConfiguredHttpUrl(value: string): Promise<URL> {
    return this.assertOutboundUrl(value, ['http:', 'https:'], false);
  }

  async assertConfiguredWebSocketUrl(value: string): Promise<URL> {
    return this.assertOutboundUrl(value, ['ws:', 'wss:'], false);
  }

  assertHttpRequestSize(encodedBody: string | undefined): void {
    if (encodedBody === undefined) return;
    assertByteLength(
      encodedBody,
      this.getConfig().outbound.maxHttpRequestBytes,
      'HTTP request body',
    );
  }

  assertWebSocketMessageSize(encodedBody: string): void {
    assertByteLength(
      encodedBody,
      this.getConfig().outbound.maxWebSocketMessageBytes,
      'WebSocket message',
    );
  }

  private async assertOutboundUrl(
    value: string,
    protocols: string[],
    resolveDns = true,
  ): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new NetworkPolicyError(
        'Outbound target is not a valid absolute URL.',
      );
    }
    if (!protocols.includes(parsed.protocol)) {
      throw new NetworkPolicyError(
        `Outbound protocol is not allowed: ${parsed.protocol || '<none>'}`,
      );
    }
    if (parsed.username || parsed.password) {
      throw new NetworkPolicyError(
        'Outbound URLs must not contain embedded credentials; use a secret-backed header.',
      );
    }
    const config = this.getConfig().outbound;
    const port = effectivePort(parsed);
    if (!config.allowedPorts.includes(port)) {
      throw new NetworkPolicyError(`Outbound port is not allowlisted: ${port}`);
    }
    const hostname = normalizedHostname(parsed);
    if (isIP(hostname)) {
      if (!isAllowedAddress(hostname, config)) {
        throw new NetworkPolicyError(
          `Outbound address is not allowlisted: ${hostname}`,
        );
      }
      return parsed;
    }
    const normalized = hostname.toLowerCase();
    const privatePolicy = privateHostnamePolicies(config).find(
      entry => entry.hostname === normalized,
    );
    if (!config.allowedHostnames.includes(normalized) && !privatePolicy) {
      throw new NetworkPolicyError(
        `Outbound hostname is not allowlisted: ${hostname}`,
      );
    }
    if (!resolveDns) return parsed;
    const addresses = await this.resolveHost(hostname);
    if (addresses.length === 0) {
      throw new NetworkPolicyError(
        `Outbound hostname did not resolve: ${hostname}`,
      );
    }
    if (hostname.toLowerCase() === 'localhost') {
      if (addresses.some(item => !isLoopbackAddress(item.address))) {
        throw new NetworkPolicyError(
          'localhost resolved to a non-loopback address.',
        );
      }
      return parsed;
    }
    if (privatePolicy) {
      const outsideAllowlist = addresses.find(
        item =>
          !privatePolicy.allowedAddresses.some(rule =>
            addressMatchesRule(item.address, rule),
          ),
      );
      if (outsideAllowlist) {
        throw new NetworkPolicyError(
          `Private outbound hostname resolved outside its address allowlist: ${outsideAllowlist.address}`,
        );
      }
      return parsed;
    }
    const restricted = addresses.find(item =>
      isRestrictedAddress(item.address),
    );
    if (restricted) {
      throw new NetworkPolicyError(
        `Public outbound hostname resolved to a restricted address: ${restricted.address}`,
      );
    }
    return parsed;
  }
}

/** Validates configured network rules before listeners or clients are changed. */
export function assertValidNetworkPolicy(network: NetworkConfig): void {
  const privatePolicies = privateHostnamePolicies(network.outbound);
  for (const rule of [
    ...network.inbound.allowedSources,
    ...network.outbound.allowedAddresses,
    ...privatePolicies.flatMap(policy => policy.allowedAddresses),
  ]) {
    if (!isAddressRule(rule)) {
      throw new NetworkPolicyError(`Invalid network address rule: ${rule}`);
    }
  }
  for (const hostname of network.outbound.allowedHostnames) {
    assertExactHostname(hostname);
  }
  const publicHostnames = new Set(network.outbound.allowedHostnames);
  const privateHostnames = new Set<string>();
  for (const policy of privatePolicies) {
    assertExactHostname(policy.hostname);
    if (policy.allowedAddresses.length === 0) {
      throw new NetworkPolicyError(
        `Private outbound hostname requires at least one address rule: ${policy.hostname}`,
      );
    }
    if (publicHostnames.has(policy.hostname)) {
      throw new NetworkPolicyError(
        `Outbound hostname cannot use public and private policies together: ${policy.hostname}`,
      );
    }
    if (privateHostnames.has(policy.hostname)) {
      throw new NetworkPolicyError(
        `Duplicate private outbound hostname policy: ${policy.hostname}`,
      );
    }
    privateHostnames.add(policy.hostname);
  }
  if (network.inbound.headersTimeoutMs > network.inbound.requestTimeoutMs) {
    throw new NetworkPolicyError(
      'network.inbound.headersTimeoutMs must not exceed requestTimeoutMs.',
    );
  }
}

/** Reads an HTTP response without allowing an unbounded allocation. */
export async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`HTTP response exceeds the ${maxBytes} byte limit.`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`HTTP response exceeds the ${maxBytes} byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/** Removes credentials and query values before a destination enters a log. */
export function safeNetworkTarget(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    if (parsed.search) parsed.search = '?[REDACTED]';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '<invalid-target>';
  }
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80;
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function privateHostnamePolicies(config: OutboundConfig) {
  return config.allowedPrivateHostnames ?? [];
}

function assertExactHostname(hostname: string): void {
  if (
    hostname !== hostname.toLowerCase() ||
    hostname.includes('*') ||
    hostname.includes('/') ||
    hostname.includes(':') ||
    hostname.trim() !== hostname
  ) {
    throw new NetworkPolicyError(
      `Outbound hostname must be an exact lowercase DNS name: ${hostname}`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostname}`);
  } catch {
    throw new NetworkPolicyError(`Invalid outbound hostname: ${hostname}`);
  }
  if (parsed.hostname !== hostname) {
    throw new NetworkPolicyError(`Invalid outbound hostname: ${hostname}`);
  }
}

function isAllowedAddress(address: string, config: OutboundConfig): boolean {
  return config.allowedAddresses.some(rule =>
    addressMatchesRule(address, rule),
  );
}

function isLoopbackAddress(address: string): boolean {
  return addressMatchesRule(address, 'loopback');
}

function isRestrictedAddress(address: string): boolean {
  return RESTRICTED_ADDRESS_RANGES.some(rule =>
    addressMatchesRule(address, rule),
  );
}

function assertByteLength(
  value: string,
  maxBytes: number,
  label: string,
): void {
  const size = Buffer.byteLength(value);
  if (size > maxBytes) {
    throw new Error(`${label} is ${size} bytes; limit is ${maxBytes} bytes.`);
  }
}
