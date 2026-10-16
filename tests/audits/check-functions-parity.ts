#!/usr/bin/env node
// Contract lineage across the serverless boundary: contracts/contact.v1.json is canonical,
// OpenAPI and the handler derive from it, and D1 is checked against the handler INSERTs.

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const read = (file: string): string => fs.readFileSync(path.join(siteRoot, file), 'utf8');

const failures: string[] = [];

const contract: { request: unknown } = JSON.parse(read('contracts/contact.v1.json'));
const openapi: { components?: { schemas?: { ContactSubmission?: unknown } } } = JSON.parse(read('contracts/contact.openapi.json'));
const submission = openapi.components?.schemas?.ContactSubmission;
if (!submission) {
  failures.push('contracts/contact.openapi.json has no components.schemas.ContactSubmission');
} else {
  if (JSON.stringify(submission) !== JSON.stringify(contract.request)) {
    failures.push('OpenAPI ContactSubmission is stale; run npm run sync:contact-openapi');
  }
  const contactSrc = read('functions/api/contact.ts');
  if (!/\bvalidateContactPayload\s*\(/.test(contactSrc)) {
    failures.push('contact handler does not validate through the canonical contract adapter');
  }
  if (/interface ContactPayload|MAX_SOURCE_URL_LENGTH|name\.length\s*>/.test(contactSrc)) {
    failures.push('contact handler has reintroduced a second request schema or field limit');
  }
}

const sql = read('cloudflare/d1.sql');
const tables = new Map<string, Set<string>>();
for (const [, table = '', body = ''] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  const columns = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'))
    .map((line) => line.split(/\s+/)[0] ?? '');
  tables.set(table, new Set(columns));
}
if (tables.size === 0) failures.push('cloudflare/d1.sql defines no CREATE TABLE statements');

const rows = read('functions/lib/database.ts');
let rowTypes = 0;
for (const [, table = '', body = ''] of rows.matchAll(/\/\/ D1 table (\w+)\nexport interface \w+ \{([\s\S]*?)\n\}/g)) {
  rowTypes += 1;
  const fields = [...body.matchAll(/^\s*(\w+):/gm)].map(([, field = '']) => field);
  const columns = [...(tables.get(table) ?? [])];
  if (fields.join(',') !== columns.join(',')) {
    failures.push(`functions/lib/database.ts row type for ${table} (${fields.join(', ')}) differs from cloudflare/d1.sql (${columns.join(', ')})`);
  }
}
if (rowTypes !== tables.size) failures.push(`functions/lib/database.ts declares ${rowTypes} row types for ${tables.size} tables`);

let insertCount = 0;
for (const file of fs.readdirSync(path.join(siteRoot, 'functions/api'))) {
  if (!file.endsWith('.ts')) continue;
  const source = read(path.join('functions/api', file));

  for (const match of source.matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)[\s\S]*?VALUES\s*\(([^)]+)\)/g)) {
    insertCount += 1;
    const [, table = '', columnList = '', valueList = ''] = match;
    const columns = columnList.split(',').map((column) => column.trim());
    const placeholders = valueList.split(',').length;

    const known = tables.get(table);
    if (!known) {
      failures.push(`functions/api/${file} inserts into "${table}", which cloudflare/d1.sql does not define`);
      continue;
    }
    for (const column of columns) {
      if (!known.has(column)) {
        failures.push(`functions/api/${file} inserts column "${column}" missing from ${table} in cloudflare/d1.sql`);
      }
    }
    if (placeholders !== columns.length) {
      failures.push(`functions/api/${file}: INSERT into ${table} binds ${placeholders} values for ${columns.length} columns`);
    }
    // An open endpoint storing caller IPs caps them inside the INSERT itself,
    // so concurrent requests cannot race a separate COUNT.
    const ipIndex = columns.indexOf('ip_address');
    const statement = source.slice(match.index).split('`', 1)[0] ?? '';
    if (ipIndex !== -1 && !new RegExp(String.raw`WHERE ip_address = \?${ipIndex + 1}\b`).test(statement)) {
      failures.push(`functions/api/${file}: INSERT into ${table} is not capped per ip_address in the same statement`);
    }
  }
}
if (insertCount === 0) failures.push('no INSERT statements found in functions/api; the parser or the handlers changed shape');

finish(failures, `contact contract drives OpenAPI/handler; ${insertCount} D1 inserts and ${rowTypes} row types match storage; inserts cap per IP`, {
  heading: 'check-functions-parity: the serverless boundary disagrees with its schemas:',
});
