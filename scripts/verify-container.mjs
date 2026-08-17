import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const suffix = randomUUID().slice(0, 8);
const image = `las-container-smoke:${suffix}`;
const container = `las-container-smoke-${suffix}`;
const volume = `las-container-smoke-${suffix}`;
const network = `las-container-smoke-${suffix}`;
const receiver = `las-container-receiver-${suffix}`;
const receiverHostname = 'private-target';
const receiverPort = 8080;
let imageCreated = false;
let containerCreated = false;
let volumeCreated = false;
let networkCreated = false;
let receiverCreated = false;

try {
  docker(['version', '--format', '{{.Server.Version}}']);
  docker(['build', '--tag', image, '.'], {stdio: 'inherit'});
  imageCreated = true;
  docker(['volume', 'create', volume]);
  volumeCreated = true;
  docker(['network', 'create', network]);
  networkCreated = true;
  docker([
    'run',
    '--detach',
    '--name',
    receiver,
    '--network',
    network,
    '--network-alias',
    receiverHostname,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--no-healthcheck',
    '--entrypoint',
    'node',
    image,
    '--input-type=module',
    '--eval',
    receiverScript(),
  ]);
  receiverCreated = true;
  docker([
    'run',
    '--detach',
    '--name',
    container,
    '--network',
    network,
    '--init',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--mount',
    `type=volume,source=${volume},target=/var/lib/las`,
    '--publish',
    '127.0.0.1::4789',
    image,
  ]);
  containerCreated = true;

  let port = publishedPort(container);
  await waitForHealthyServer(port);
  await waitForContainerHealth(container);
  assertEqual(
    docker(['inspect', '--format', '{{.Config.User}}', container]),
    'node',
    'runtime user',
  );
  assertEqual(
    docker(['inspect', '--format', '{{.State.Health.Status}}', container]),
    'healthy',
    'container health',
  );
  const firstSecretsHash = secretsHash(container);
  const receiverAddress = containerNetworkAddress(receiver, network);
  configurePrivateTarget(container, receiverAddress);

  docker(['restart', '--time', '20', container]);
  port = publishedPort(container);
  await waitForHealthyServer(port);
  await waitForContainerHealth(container);
  assertEqual(secretsHash(container), firstSecretsHash, 'persisted secrets');
  await runPrivateNetworkAction(port, adminToken(container));

  console.log(
    `Container smoke test passed on 127.0.0.1:${port}, including private service DNS.`,
  );
} catch (error) {
  if (containerCreated) {
    const logs = docker(['logs', container], {allowFailure: true});
    if (logs) console.error(`Container logs:\n${logs}`);
  }
  if (receiverCreated) {
    const logs = docker(['logs', receiver], {allowFailure: true});
    if (logs) console.error(`Receiver logs:\n${logs}`);
  }
  throw error;
} finally {
  if (containerCreated) {
    docker(['rm', '--force', container], {allowFailure: true});
  }
  if (receiverCreated) {
    docker(['rm', '--force', receiver], {allowFailure: true});
  }
  if (networkCreated) {
    docker(['network', 'rm', network], {allowFailure: true});
  }
  if (volumeCreated) {
    docker(['volume', 'rm', '--force', volume], {allowFailure: true});
  }
  if (imageCreated) {
    docker(['image', 'rm', '--force', image], {allowFailure: true});
  }
}

function receiverScript() {
  return [
    "import {createServer} from 'node:http';",
    'createServer(async (request, response) => {',
    "  let body = '';",
    '  for await (const chunk of request) body += chunk;',
    "  response.writeHead(200, {'content-type': 'application/json'});",
    '  response.end(JSON.stringify({',
    '    received: true,',
    '    method: request.method,',
    '    path: request.url,',
    '    bytes: Buffer.byteLength(body),',
    '  }));',
    `}).listen(${receiverPort}, '0.0.0.0');`,
  ].join('\n');
}

function containerNetworkAddress(name, networkName) {
  const inspection = JSON.parse(docker(['inspect', name]))[0];
  const address =
    inspection?.NetworkSettings?.Networks?.[networkName]?.IPAddress;
  if (!address) {
    throw new Error(`Cannot determine ${name}'s address on ${networkName}.`);
  }
  return address;
}

function configurePrivateTarget(name, address) {
  const appPath = '/var/lib/las/config/app.yaml';
  const actionsPath = '/var/lib/las/config/actions.yaml';
  const app = YAML.parse(readContainerFile(name, appPath));
  app.network.outbound.allowedPrivateHostnames = [
    {hostname: receiverHostname, allowedAddresses: [address]},
  ];
  app.network.outbound.allowedPorts = [
    ...new Set([...app.network.outbound.allowedPorts, receiverPort]),
  ].sort((left, right) => left - right);
  writeContainerFile(name, appPath, YAML.stringify(app));
  const actionsDocument = YAML.parse(readContainerFile(name, actionsPath));
  const actions = actionsDocument.actions.filter(
    action => action.id !== 'container_private_send',
  );
  actions.push({
    id: 'container_private_send',
    description: 'Container network smoke-test action.',
    type: 'send_http',
    method: 'POST',
    url: `http://${receiverHostname}:${receiverPort}/receive`,
    headers: {},
    body: {message: 'container network test'},
    timeoutMs: 5_000,
  });
  writeContainerFile(
    name,
    actionsPath,
    YAML.stringify({
      version: 1,
      actions,
    }),
  );
}

function readContainerFile(name, filePath) {
  return docker([
    'exec',
    name,
    'node',
    '--input-type=module',
    '--eval',
    "import {readFileSync} from 'node:fs'; process.stdout.write(readFileSync(process.argv[1], 'utf8'));",
    filePath,
  ]);
}

function writeContainerFile(name, filePath, value) {
  docker(
    [
      'exec',
      '--interactive',
      name,
      'node',
      '--input-type=module',
      '--eval',
      "import {writeFileSync} from 'node:fs'; let value = ''; for await (const chunk of process.stdin) value += chunk; writeFileSync(process.argv[1], value, {mode: 0o600});",
      filePath,
    ],
    {input: value},
  );
}

function adminToken(name) {
  const document = YAML.parse(
    readContainerFile(name, '/var/lib/las/config/secrets.yaml'),
  );
  const token = document?.secrets?.apiToken;
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('Container administrator token was not initialized.');
  }
  return token;
}

async function runPrivateNetworkAction(port, token) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const response = await fetch(
    `${baseUrl}/api/actions/container_private_send/run`,
    {
      method: 'POST',
      headers: {'x-las-token': token},
      signal: AbortSignal.timeout(5_000),
    },
  );
  const queued = await response.json();
  if (!response.ok || queued?.status !== 'queued' || !queued?.id) {
    throw new Error(
      `Private network action was not queued: HTTP ${response.status} ${JSON.stringify(queued)}`,
    );
  }

  let lastStatus = 'queued';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const runsResponse = await fetch(
      `${baseUrl}/api/runs?actionId=container_private_send&limit=20`,
      {
        headers: {'x-las-token': token},
        signal: AbortSignal.timeout(2_000),
      },
    );
    const runs = await runsResponse.json();
    if (!runsResponse.ok || !Array.isArray(runs)) {
      throw new Error(`Cannot read private network action result.`);
    }
    const run = runs.find(item => item.id === queued.id);
    if (run) {
      lastStatus = run.status;
      if (run.status === 'completed' && run.ok === true) return;
      if (run.status === 'failed' || run.status === 'cancelled') {
        throw new Error(
          `Private network action ${run.status}: ${run.error ?? '<no error>'}`,
        );
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Private network action remained ${lastStatus}.`);
}

function publishedPort(name) {
  const output = docker(['port', name, '4789/tcp']);
  const match = output.match(/127\.0\.0\.1:(\d+)/u);
  if (!match) throw new Error(`Cannot parse published port: ${output}`);
  return Number(match[1]);
}

async function waitForHealthyServer(port) {
  const url = `http://127.0.0.1:${port}`;
  let lastError = 'not started';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await health.json();
      const web = await fetch(`${url}/ui/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000),
      });
      if (health.ok && body?.ok === true && web.ok) return;
      lastError = `health ${health.status}, WebUI ${web.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Container did not become ready: ${lastError}`);
}

async function waitForContainerHealth(name) {
  let status = 'unknown';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    status = docker(['inspect', '--format', '{{.State.Health.Status}}', name]);
    if (status === 'healthy') return;
    if (status === 'unhealthy') break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Container health status is ${status}.`);
}

function secretsHash(name) {
  return docker([
    'exec',
    name,
    'node',
    '--input-type=module',
    '--eval',
    "import {createHash} from 'node:crypto'; import {readFileSync} from 'node:fs'; console.log(createHash('sha256').update(readFileSync('/var/lib/las/config/secrets.yaml')).digest('hex'));",
  ]);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${expected}, received ${actual}`,
    );
  }
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: rootDir,
    encoding: 'utf8',
    input: options.input,
    stdio: options.stdio ?? 'pipe',
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error && !options.allowFailure) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args[0]} failed: ${output}`);
  }
  return output;
}
