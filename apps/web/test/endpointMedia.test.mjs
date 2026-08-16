import assert from 'node:assert/strict';
import test from 'node:test';
import {collectEndpointMediaCacheInfo} from '../src/endpointMedia.ts';

test('reports a confirmed media cache path', () => {
  assert.deepEqual(
    collectEndpointMediaCacheInfo({
      content: {
        images: [
          {
            kind: 'image',
            file_path: 'C:/media/image.png',
            extra: {cached: true},
          },
        ],
      },
    }),
    [
      {
        key: 'images-0',
        kind: 'image',
        index: 0,
        filePath: 'C:/media/image.png',
        hasRemoteSource: false,
        status: 'cached',
      },
    ],
  );
});

test('does not claim that an unmarked local reference is cached', () => {
  const [media] = collectEndpointMediaCacheInfo({
    content: {
      videos: [
        {
          kind: 'video',
          file_path: 'relative-video.mp4',
          name: 'video.mp4',
          extra: {},
        },
      ],
    },
  });
  assert.equal(media.status, 'referenced');
  assert.equal(media.filePath, 'relative-video.mp4');
});

test('preserves cache failures and remote-only references', () => {
  const [media] = collectEndpointMediaCacheInfo({
    content: {
      images: [
        {
          kind: 'image',
          url: 'https://example.invalid/temporary-image',
          file_path: '',
          extra: {cached: false, cache_error: 'download rejected'},
        },
      ],
    },
  });
  assert.equal(media.status, 'failed');
  assert.equal(media.filePath, undefined);
  assert.equal(media.hasRemoteSource, true);
  assert.equal(media.error, 'download rejected');
});

test('reports absent media data for an explicitly typed message', () => {
  assert.deepEqual(
    collectEndpointMediaCacheInfo(
      {message_type: 'file', content: {files: []}},
      'file',
    ),
    [
      {
        key: 'file-missing',
        kind: 'file',
        index: 0,
        hasRemoteSource: false,
        status: 'unavailable',
      },
    ],
  );
  assert.deepEqual(
    collectEndpointMediaCacheInfo(
      {message_type: 'text', content: {images: []}},
      'text',
    ),
    [],
  );
});
