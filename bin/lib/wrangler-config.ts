// wrangler.jsonc, the Worker's declared config, for the scripts that hold other facts to it.
// Read with jsonc-parser and the options wrangler's own parseJSONC passes, so a file wrangler
// accepts parses here the same way, without loading wrangler.
import fs from 'node:fs';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { fromRoot } from '../../src/lib/site-root.ts';

export interface WranglerConfig {
  name: string;
  compatibility_date: string;
  d1_databases: { binding: string; database_name: string }[];
}

export function wranglerConfig(file = fromRoot('wrangler.jsonc')): WranglerConfig {
  const errors: ParseError[] = [];
  const config = parse(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
  const [error] = errors;
  if (error) throw new Error(`${file}: ${printParseErrorCode(error.error)} at offset ${error.offset}`);
  return config;
}
