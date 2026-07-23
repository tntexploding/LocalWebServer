import {mkdir, open, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** Replaces a text file through a same-directory temporary file and rename. */
export async function writeTextFileAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const handle = await open(temporary, 'r');
    try {
      await handle.sync().catch(error => {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EINVAL'].includes(code ?? '')
        ) {
          throw error;
        }
      });
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
