import {readFile} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

/** Loads explicit backend and WebUI development listeners from local files. */
export async function loadDevelopmentSettings(projectRoot) {
  const [appConfig, webConfig] = await Promise.all([
    readYaml(path.join(projectRoot, 'config', 'app.yaml')),
    readYaml(path.join(projectRoot, 'config', 'web.yaml')),
  ]);
  const backendHost = requiredHost(
    appConfig?.server?.host,
    'config/app.yaml server.host',
  );
  const backendPort = requiredPort(
    appConfig?.server?.port,
    'config/app.yaml server.port',
  );
  const webHost = requiredHost(webConfig?.host, 'config/web.yaml host');
  const webPort = requiredPort(webConfig?.port, 'config/web.yaml port');
  const previewPort = requiredPort(
    webConfig?.previewPort,
    'config/web.yaml previewPort',
  );
  const apiBase = `http://${formatUrlHost(connectHost(backendHost))}:${backendPort}`;
  const webUrl = `http://${formatUrlHost(connectHost(webHost))}:${webPort}/ui/`;
  const previewUrl = `http://${formatUrlHost(connectHost(webHost))}:${previewPort}/ui/`;
  return {
    backendHost,
    backendPort,
    webHost,
    webPort,
    previewPort,
    apiBase,
    webUrl,
    previewUrl,
  };
}

async function readYaml(filePath) {
  const source = await readFile(filePath, 'utf8').catch(error => {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  });
  const value = YAML.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a YAML object.`);
  }
  if (value.version !== 1) {
    throw new Error(`${filePath} must use version 1.`);
  }
  return value;
}

function requiredHost(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredPort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function connectHost(host) {
  return host === '0.0.0.0' || host === '::' || host === '[::]'
    ? '127.0.0.1'
    : host;
}

function formatUrlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
