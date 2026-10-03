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

// Temp dirs made during a file's tests, removed by one after() hook.
export function scratchDirs(prefix: string): { make: () => string; cleanup: () => void } {
  const made: string[] = [];
  return {
    make: () => {
      const dir = tempDir(prefix);
      made.push(dir);
      return dir;
    },
    cleanup: () => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
