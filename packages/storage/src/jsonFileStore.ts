import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Small atomically replaced JSON document used for runtime state. */
export class JsonFileStore<T> {
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(fallback: T): Promise<T> {
    await this.writeChain;
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }

  save(value: T): Promise<void> {
    const write = this.writeChain.then(() => this.saveValue(value));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private async saveValue(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), {recursive: true});
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }
}
