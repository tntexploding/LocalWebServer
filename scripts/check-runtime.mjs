import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadReleasePolicy, runtimeRecommendation} from './runtime-policy.mjs';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const policy = await loadReleasePolicy(rootDir);
const recommendation = runtimeRecommendation(
  process.versions.node,
  policy.recommendedNodeVersion,
  policy.recommendedNodeMajor,
);
if (recommendation) {
  console.warn(
    `Node.js recommendation: ${recommendation} Startup will continue.`,
  );
} else {
  console.log(
    `Node.js ${process.versions.node} matches the recommended runtime policy.`,
  );
}
