import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const builder = `las-platforms-${randomUUID().slice(0, 8)}`;
let builderCreated = false;

try {
  docker(['version', '--format', '{{.Server.Version}}']);
  docker([
    'buildx',
    'create',
    '--name',
    builder,
    '--driver',
    'docker-container',
  ]);
  builderCreated = true;
  docker(['buildx', 'inspect', '--bootstrap', builder], {stdio: 'inherit'});
  docker(
    [
      'buildx',
      'build',
      '--builder',
      builder,
      '--platform',
      'linux/amd64,linux/arm64',
      '--output',
      'type=cacheonly',
      '--provenance=false',
      '--sbom=false',
      '--progress=plain',
      '.',
    ],
    {stdio: 'inherit'},
  );
  console.log('Multi-platform container build passed for amd64 and arm64.');
} finally {
  if (builderCreated) {
    docker(['buildx', 'rm', builder], {allowFailure: true});
  }
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error && !options.allowFailure) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${output}`);
  }
  return output;
}
