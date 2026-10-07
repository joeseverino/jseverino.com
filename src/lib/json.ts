// Nothing is validated here: the caller names the shape, and a file that needs checking goes through its schema.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './site-root.ts';

export const readJson = <T>(file: string | URL): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

export const packageScripts = (root = siteRoot): Record<string, string> =>
  readJson<{ scripts?: Record<string, string> }>(path.join(root, 'package.json')).scripts ?? {};
