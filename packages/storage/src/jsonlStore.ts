import {appendFile, mkdir, readFile, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';

export interface JsonlStoreOptions {
  maxBytes?: number;
  maxFiles?: number;
}

/** Append-only JSON Lines storage with bounded rotation and newest-first reads. */
export class JsonlStore<T extends object> {
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly options: JsonlStoreOptions = {},
  ) {}

  append(row: T): Promise<void> {
    const encoded = `${JSON.stringify(row)}\n`;
    const write = this.writeChain.then(() => this.appendEncoded(encoded));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  async latest(limit = 100): Promise<T[]> {
    await this.writeChain;
    const rows: T[] = [];
    for (const file of this.filesNewestFirst()) {
      const lines = await readLines(file);
      for (const line of lines.reverse()) {
        const row = parseLine<T>(line);
        if (!row) continue;
        rows.push(row);
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  async findById(id: string): Promise<T | undefined> {
    await this.writeChain;
    for (const file of this.filesNewestFirst()) {
      const lines = await readLines(file);
      for (const line of lines.reverse()) {
        const row = parseLine<T & {id?: string}>(line);
        if (!row) continue;
        if (row.id === id) return row;
      }
    }
    return undefined;
  }

  private async appendEncoded(encoded: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), {recursive: true});
    if (await this.shouldRotate(Buffer.byteLength(encoded))) {
      await this.rotate();
    }
    await appendFile(this.filePath, encoded, 'utf8');
  }

  private async shouldRotate(nextBytes: number): Promise<boolean> {
    const maxBytes = this.options.maxBytes;
    if (!maxBytes) return false;
    try {
      return (await stat(this.filePath)).size + nextBytes > maxBytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async rotate(): Promise<void> {
    const maxFiles = Math.max(1, this.options.maxFiles ?? 5);
    await rm(this.rotatedPath(maxFiles), {force: true});
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      await renameIfPresent(
        this.rotatedPath(index),
        this.rotatedPath(index + 1),
      );
    }
    await renameIfPresent(this.filePath, this.rotatedPath(1));
  }

  private filesNewestFirst(): string[] {
    const maxFiles = Math.max(0, this.options.maxFiles ?? 5);
    return [
      this.filePath,
      ...Array.from({length: maxFiles}, (_, index) =>
        this.rotatedPath(index + 1),
      ),
    ];
  }

  private rotatedPath(index: number): string {
    return `${this.filePath}.${index}`;
  }
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    return (await readFile(filePath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function parseLine<T>(line: string): T | undefined {
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

async function renameIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await stat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(destination, {force: true});
  await rename(source, destination);
}
