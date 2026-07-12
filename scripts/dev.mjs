import {spawn} from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();

async function main() {
  await run('build:core', ['run', 'build', '-w', '@las/core']);
  await run('build:storage', ['run', 'build', '-w', '@las/storage']);

  start('server', ['run', 'dev', '-w', '@las/server']);
  start('web', ['run', 'dev', '-w', '@las/web']);
}

function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${name} exited with ${signal ?? code}`));
    });
  });
}

function start(name, args) {
  const child = spawnCommand(args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${name}] exited with ${signal ?? code}`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

function spawnCommand(args, options) {
  if (process.platform !== 'win32') {
    return spawn(npmCommand, args, options);
  }
  return spawn('cmd.exe', ['/d', '/s', '/c', commandLine(args)], options);
}

function commandLine(args) {
  return [npmCommand, ...args].map(quoteCmdArg).join(' ');
}

function quoteCmdArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function stopAll() {
  for (const child of children) {
    child.kill();
  }
}

process.once('SIGINT', () => {
  stopAll();
  process.exit(130);
});

process.once('SIGTERM', () => {
  stopAll();
  process.exit(143);
});

main().catch(error => {
  console.error(error);
  stopAll();
  process.exit(1);
});
