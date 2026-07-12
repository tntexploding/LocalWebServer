import {mkdir, readFile, appendFile} from 'node:fs/promises';
import path from 'node:path';

/** Append-only JSON Lines storage with newest-first read helpers. */
export class JsonlStore<T extends object> {
  constructor(private readonly filePath: string) {}

  async append(row: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), {recursive: true});
    await appendFile(this.filePath, `${JSON.stringify(row)}\n`, 'utf8');
  }

  async latest(limit = 100): Promise<T[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map(line => JSON.parse(line) as T)
        .reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async findById(id: string): Promise<T | undefined> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      for (const line of content.trim().split('\n').filter(Boolean).reverse()) {
        const row = JSON.parse(line) as T & {id?: string};
        if (row.id === id) {
          return row;
        }
      }
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}
