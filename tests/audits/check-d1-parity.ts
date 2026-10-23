// Contract lineage across the Worker boundary: the contact handler validates through
// contracts/contact.v1.json, D1 is checked against the handlers' INSERTs, and the binding
// in wrangler.jsonc names the database site-config.ts does. checks:contracts holds the
// OpenAPI projection to the contract.

import fs from 'node:fs';
import path from 'node:path';
import { wranglerConfig } from '../../bin/lib/wrangler-config.ts';
import { SITE } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const read = (file: string): string => fs.readFileSync(path.join(siteRoot, file), 'utf8');

const failures: string[] = [];

const HANDLERS = 'src/lib/api';
const contactSrc = read(`${HANDLERS}/contact.ts`);
if (!/\bvalidateContactPayload\s*\(/.test(contactSrc)) {
  failures.push('contact handler does not validate through the canonical contract adapter');
}
if (/interface ContactPayload|MAX_SOURCE_URL_LENGTH|name\.length\s*>/.test(contactSrc)) {
  failures.push('contact handler has reintroduced a second request schema or field limit');
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

const ROWS = `${HANDLERS}/d1.ts`;
const rows = read(ROWS);
let rowTypes = 0;
for (const [, table = '', body = ''] of rows.matchAll(/\/\/ D1 table (\w+)\nexport interface \w+ \{([\s\S]*?)\n\}/g)) {
  rowTypes += 1;
  const fields = [...body.matchAll(/^\s*(\w+):/gm)].map(([, field = '']) => field);
  const columns = [...(tables.get(table) ?? [])];
  if (fields.join(',') !== columns.join(',')) {
    failures.push(`${ROWS} row type for ${table} (${fields.join(', ')}) differs from cloudflare/d1.sql (${columns.join(', ')})`);
  }
}
if (rowTypes !== tables.size) failures.push(`${ROWS} declares ${rowTypes} row types for ${tables.size} tables`);

let insertCount = 0;
for (const file of fs.readdirSync(path.join(siteRoot, HANDLERS))) {
  if (!file.endsWith('.ts')) continue;
  const source = read(path.join(HANDLERS, file));

  for (const match of source.matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)[\s\S]*?VALUES\s*\(([^)]+)\)/g)) {
    insertCount += 1;
    const [, table = '', columnList = '', valueList = ''] = match;
    const columns = columnList.split(',').map((column) => column.trim());
    const placeholders = valueList.split(',').length;

    const known = tables.get(table);
    if (!known) {
      failures.push(`${HANDLERS}/${file} inserts into "${table}", which cloudflare/d1.sql does not define`);
      continue;
    }
    for (const column of columns) {
      if (!known.has(column)) {
        failures.push(`${HANDLERS}/${file} inserts column "${column}" missing from ${table} in cloudflare/d1.sql`);
      }
    }
    if (placeholders !== columns.length) {
      failures.push(`${HANDLERS}/${file}: INSERT into ${table} binds ${placeholders} values for ${columns.length} columns`);
    }
    // An open endpoint storing caller IPs caps them inside the INSERT itself,
    // so concurrent requests cannot race a separate COUNT.
    const ipIndex = columns.indexOf('ip_address');
    const statement = source.slice(match.index).split('`', 1)[0] ?? '';
    if (ipIndex !== -1 && !new RegExp(String.raw`WHERE ip_address = \?${ipIndex + 1}\b`).test(statement)) {
      failures.push(`${HANDLERS}/${file}: INSERT into ${table} is not capped per ip_address in the same statement`);
    }
  }
}
if (insertCount === 0) failures.push(`no INSERT statements found in ${HANDLERS}; the parser or the handlers changed shape`);

const databases = wranglerConfig().d1_databases.map(({ database_name }) => database_name);
if (databases.join() !== SITE.d1) failures.push(`wrangler.jsonc binds D1 ${databases.join(', ') || '<none>'}, src/lib/site-config.ts names ${SITE.d1}`);

finish(
  failures,
  `contact handler validates through the contract; ${insertCount} D1 inserts and ${rowTypes} row types match storage; inserts cap per IP; the binding names ${SITE.d1}`,
  {
    heading: 'check-d1-parity: the Worker boundary disagrees with its schemas:',
    fix: 'fix: the handlers in src/lib/api, cloudflare/d1.sql and the D1 binding in wrangler.jsonc change together',
  },
);
