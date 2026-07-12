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
      'data/**',
    ],
  },
  ...gts,
];
