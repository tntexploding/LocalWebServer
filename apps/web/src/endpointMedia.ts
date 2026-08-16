export type EndpointMediaKind = 'image' | 'video' | 'file' | 'audio';

export type EndpointMediaCacheStatus =
  'cached' | 'referenced' | 'failed' | 'unavailable';

/** Cache metadata derived from one received media reference. */
export interface EndpointMediaCacheInfo {
  key: string;
  kind: EndpointMediaKind;
  index: number;
  name?: string;
  filePath?: string;
  hasRemoteSource: boolean;
  status: EndpointMediaCacheStatus;
  error?: string;
}

interface MediaGroup {
  key: string;
  kind: EndpointMediaKind;
}

const MEDIA_GROUPS: MediaGroup[] = [
  {key: 'images', kind: 'image'},
  {key: 'videos', kind: 'video'},
  {key: 'files', kind: 'file'},
  {key: 'attachments', kind: 'file'},
  {key: 'audios', kind: 'audio'},
];

const MEDIA_KINDS = new Set<EndpointMediaKind>([
  'image',
  'video',
  'file',
  'audio',
]);

/** Returns cache details for media carried by a received message body. */
export function collectEndpointMediaCacheInfo(
  body: unknown,
  messageType?: string,
): EndpointMediaCacheInfo[] {
  if (!isRecord(body) || !isRecord(body.content)) {
    return syntheticMissingMedia(messageType);
  }

  const result: EndpointMediaCacheInfo[] = [];
  for (const group of MEDIA_GROUPS) {
    const values = body.content[group.key];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (!isRecord(value)) return;
      result.push(mediaCacheInfo(value, group, index));
    });
  }

  return result.length > 0 ? result : syntheticMissingMedia(messageType);
}

function mediaCacheInfo(
  media: Record<string, unknown>,
  group: MediaGroup,
  index: number,
): EndpointMediaCacheInfo {
  const extra = isRecord(media.extra) ? media.extra : {};
  const kind = mediaKind(media.kind, group.kind);
  const filePath = nonEmptyString(media.file_path);
  const error = nonEmptyString(extra.cache_error);
  const cached = typeof extra.cached === 'boolean' ? extra.cached : undefined;
  const status = cacheStatus(filePath, cached, error);
  const name =
    nonEmptyString(media.name) ?? nonEmptyString(media.file_name) ?? undefined;

  return {
    key: `${group.key}-${index}`,
    kind,
    index,
    ...(name ? {name} : {}),
    ...(filePath ? {filePath} : {}),
    hasRemoteSource: Boolean(nonEmptyString(media.url)),
    status,
    ...(error ? {error} : {}),
  };
}

function cacheStatus(
  filePath: string | undefined,
  cached: boolean | undefined,
  error: string | undefined,
): EndpointMediaCacheStatus {
  if (cached === false || error) return 'failed';
  if (filePath && cached === true) return 'cached';
  if (filePath) return 'referenced';
  return 'unavailable';
}

function syntheticMissingMedia(
  messageType: string | undefined,
): EndpointMediaCacheInfo[] {
  if (!MEDIA_KINDS.has(messageType as EndpointMediaKind)) return [];
  const kind = messageType as EndpointMediaKind;
  return [
    {
      key: `${kind}-missing`,
      kind,
      index: 0,
      hasRemoteSource: false,
      status: 'unavailable',
    },
  ];
}

function mediaKind(
  value: unknown,
  fallback: EndpointMediaKind,
): EndpointMediaKind {
  return MEDIA_KINDS.has(value as EndpointMediaKind)
    ? (value as EndpointMediaKind)
    : fallback;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
