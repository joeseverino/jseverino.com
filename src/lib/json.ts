// JSON files read whole, for the build and every script. The caller names the
// shape it expects (an annotation or a type argument); nothing is validated
// here, so a file that needs checking goes through its schema after the read.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './site-root.ts';

export const readJson = <T>(file: string | URL): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

// The npm scripts, as help, sync-docs, and the docs audits list them.
export const packageScripts = (root = siteRoot): Record<string, string> =>
  readJson<{ scripts?: Record<string, string> }>(path.join(root, 'package.json')).scripts ?? {};
