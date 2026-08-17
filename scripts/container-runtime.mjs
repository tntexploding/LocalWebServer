import {constants} from 'node:fs';
import {copyFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

const CONFIG_SOURCES = new Map([
  ['app.yaml', 'app.container.example.yaml'],
  ['endpoints.yaml', 'endpoints.example.yaml'],
  ['rules.yaml', 'rules.example.yaml'],
  ['actions.yaml', 'actions.example.yaml'],
]);

/** Initializes an empty container state directory without replacing user data. */
export async function bootstrapContainerRuntime({codeRoot, rootDir}) {
  const configDir = path.join(rootDir, 'config');
  await mkdir(configDir, {recursive: true});
  await mkdir(path.join(rootDir, 'data'), {recursive: true});

  const copied = [];
  for (const [targetName, sourceName] of CONFIG_SOURCES) {
    const source = path.join(codeRoot, 'config', sourceName);
    const target = path.join(configDir, targetName);
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      copied.push(targetName);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return copied;
}
