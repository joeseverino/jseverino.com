// Nothing is validated here: the caller names the shape, and a file that needs checking goes through its schema.
import fs from 'node:fs';
import path from 'node:path';

export const readJson = <T>(file: string | URL): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

// The form every JSON file the repo writes takes: two-space indent and a final newline, so a
// regenerated file diffs only where its data moved.
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jsonText(value));
}
