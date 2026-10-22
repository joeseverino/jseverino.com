// wrangler.jsonc, the Worker's declared config, for the scripts that hold other facts to it.
// TypeScript's parser for its own JSONC config files reads it; Node has no JSONC parser, and
// loading wrangler to read it takes seconds. TypeScript loads on the first read, so importing
// this module costs nothing.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fromRoot } from '../../src/lib/site-root.ts';

const require = createRequire(import.meta.url);

export interface WranglerConfig {
  name: string;
  compatibility_date: string;
  d1_databases: { binding: string; database_name: string }[];
}

export function wranglerConfig(file = fromRoot('wrangler.jsonc')): WranglerConfig {
  const ts: typeof import('typescript') = require('typescript');
  const { config, error } = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, 'utf8'));
  if (error) throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  return config;
}
