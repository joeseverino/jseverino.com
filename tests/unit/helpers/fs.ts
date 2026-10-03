// Scratch files for the unit tests: a real (symlink-resolved) temp directory,
// and a write that creates the parents first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tempDir = (prefix: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

export function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
