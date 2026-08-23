import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {MessageTemplateDecoder} from '../dist/messageTemplateDecoder.js';

test('decodes media variants and prefers meaningful alternate paths', async t => {
  const root = await createTemplateRoot(mediaTemplate());
  t.after(() => rm(root, {recursive: true, force: true}));
  const decoder = new MessageTemplateDecoder(root);

  const image = await decoder.decode('media.json', {
    content: {
      images: [
        {
          kind: 'image',
          url: 'https://example.invalid/image',
          file_path: '',
          mime_type: '',
          sha256: '',
        },
      ],
    },
  });
  assert.equal(image.matched, true);
  assert.equal(image.values.image_source, 'https://example.invalid/image');
  assert.deepEqual(
    image.displayItems.map(item => item.label),
    ['Image source'],
  );

  const video = await decoder.decode('media.json', {
    content: {
      videos: [
        {
          kind: 'video',
          url: '',
          file_path: 'media/video.mp4',
        },
      ],
    },
  });
  assert.equal(video.matched, true);
  assert.equal(video.values.video_source, 'media/video.mp4');
  assert.equal(
    video.displayItems.find(item => item.label === 'Video source')?.path,
    '$.content.videos[0].file_path',
  );

  const file = await decoder.decode('media.json', {
    content: {files: [{kind: 'file', name: 'report.pdf'}]},
  });
  assert.equal(file.matched, true);
  assert.equal(file.values.file_name, 'report.pdf');

  const advanced = await decoder.decode('media.json', {
    message_type: 'mixed',
    content: {
      links: [
        {
          kind: 'share',
          title: 'Shared page',
          url: 'https://example.invalid/page',
        },
      ],
      forwards: [
        {
          forward_id: 'forward-1',
          nodes: [{sender_name: 'Alice', text: 'Forwarded text', segments: []}],
        },
      ],
    },
  });
  assert.equal(advanced.matched, true);
  assert.equal(advanced.values.message_type, 'mixed');
  assert.equal(advanced.values.link_title, 'Shared page');
  assert.equal(advanced.values.forward_sender, 'Alice');
  assert.equal(advanced.values.forward_text, 'Forwarded text');

  const legacy = await decoder.decode('media.json', {content: {}});
  assert.equal(legacy.matched, true);
  assert.deepEqual(legacy.displayItems, []);
});

test('compiles unchanged templates once across concurrent callers', async t => {
  const root = await createTemplateRoot(mediaTemplate());
  t.after(() => rm(root, {recursive: true, force: true}));
  const decoder = new MessageTemplateDecoder(root);
  const originalCompile = decoder.ajv.compile.bind(decoder.ajv);
  let compileCount = 0;
  decoder.ajv.compile = schema => {
    compileCount += 1;
    return originalCompile(schema);
  };

  await Promise.all([
    ...Array.from({length: 20}, () => decoder.list()),
    ...Array.from({length: 20}, () =>
      decoder.decode('media.json', {content: {}}),
    ),
  ]);
  await decoder.list();
  await decoder.decode('media.json', {content: {}});

  assert.equal(compileCount, 1);
  assert.equal(decoder.cache.size, 1);
  assert.equal(decoder.pendingLoads.size, 0);
});

test('reloads changed templates and releases deleted entries', async t => {
  const root = await createTemplateRoot(mediaTemplate());
  t.after(() => rm(root, {recursive: true, force: true}));
  const decoder = new MessageTemplateDecoder(root);
  const originalCompile = decoder.ajv.compile.bind(decoder.ajv);
  let compileCount = 0;
  decoder.ajv.compile = schema => {
    compileCount += 1;
    return originalCompile(schema);
  };

  assert.equal((await decoder.list())[0].displayName, 'Test media');
  const changed = mediaTemplate();
  changed.name = 'Changed media';
  await writeFile(
    path.join(root, 'config', 'templates', 'media.json'),
    `${JSON.stringify(changed, null, 2)}\n`,
    'utf8',
  );

  assert.equal((await decoder.list())[0].displayName, 'Changed media');
  assert.equal(compileCount, 2);

  await rm(path.join(root, 'config', 'templates', 'media.json'));
  assert.deepEqual(await decoder.list(), []);
  assert.equal(decoder.cache.size, 0);
});

async function createTemplateRoot(template) {
  const root = await mkdtemp(path.join(tmpdir(), 'las-template-'));
  const directory = path.join(root, 'config', 'templates');
  await mkdir(directory, {recursive: true});
  await writeFile(
    path.join(directory, 'media.json'),
    `${JSON.stringify(template, null, 2)}\n`,
    'utf8',
  );
  return root;
}

function mediaTemplate() {
  const media = {
    type: 'object',
    properties: {
      kind: {type: 'string'},
      url: {type: 'string'},
      file_path: {type: 'string'},
      name: {type: 'string'},
      mime_type: {type: 'string'},
      sha256: {type: 'string'},
      size_bytes: {type: 'integer'},
    },
    additionalProperties: false,
  };
  const field = (key, label, pathValue, paths = []) => ({
    key,
    label,
    path: pathValue,
    ...(paths.length ? {paths} : {}),
    description: `${label} extracted from a test media message.`,
    required: false,
    valueType: 'string',
    roles: {display: true, send: false, match: true},
  });
  return {
    templateVersion: '2.0',
    id: 'test-media',
    name: 'Test media',
    description: 'Synthetic media contract for decoder regression tests.',
    contentType: 'application/json',
    capabilities: {receive: true, send: false, match: true},
    schema: {
      type: 'object',
      required: ['content'],
      properties: {
        message_type: {
          type: 'string',
          enum: ['text', 'image', 'video', 'file', 'mixed'],
        },
        content: {
          type: 'object',
          properties: {
            images: {type: 'array', items: media},
            videos: {type: 'array', items: media},
            files: {type: 'array', items: media},
            links: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: {type: 'string'},
                  title: {type: 'string'},
                  url: {type: 'string'},
                },
                additionalProperties: false,
              },
            },
            forwards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  forward_id: {type: 'string'},
                  nodes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        sender_name: {type: 'string'},
                        text: {type: 'string'},
                        segments: {type: 'array'},
                      },
                      additionalProperties: false,
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    minimum: {body: {}, pruneEmpty: true},
    fields: [
      field('message_type', 'Message type', '$.message_type'),
      field('image_source', 'Image source', '$.content.images[0].file_path', [
        '$.content.images[0].url',
      ]),
      field('image_mime', 'Image MIME', '$.content.images[0].mime_type'),
      field('video_source', 'Video source', '$.content.videos[0].file_path', [
        '$.content.videos[0].url',
      ]),
      field('file_name', 'File name', '$.content.files[0].name'),
      field('link_title', 'Link title', '$.content.links[0].title'),
      field(
        'forward_sender',
        'Forward sender',
        '$.content.forwards[0].nodes[0].sender_name',
      ),
      field(
        'forward_text',
        'Forward text',
        '$.content.forwards[0].nodes[0].text',
      ),
      field('optional_caption', 'Optional caption', '$.content.caption'),
    ],
    constraints: [],
    examples: [
      {
        name: 'Legacy empty content',
        description: 'A source adapter did not expose its media component.',
        body: {content: {}},
      },
    ],
    notes: [],
  };
}
