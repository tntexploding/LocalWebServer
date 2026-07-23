const gts = require('gts');

module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      '.agents/**',
      '.codex/**',
      'custom/**',
      'data/**',
      'release/**',
      'playwright-report/**',
      'test-results/**',
      'tests/.artifacts/**',
    ],
  },
  ...gts,
];
