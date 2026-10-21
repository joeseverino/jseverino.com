// Nothing is validated here: the caller names the shape, and a file that needs checking goes through its schema.
import fs from 'node:fs';

export const readJson = <T>(file: string | URL): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
