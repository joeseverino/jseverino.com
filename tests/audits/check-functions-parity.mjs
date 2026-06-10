#!/usr/bin/env node
// Parity across the serverless boundary — the deploy-side sibling of
// check-vault-mcp-parity. The same shape is declared in three places that
// nothing else keeps aligned:
//
//   1. db/contact-openapi.json   — the API Shield schema Cloudflare enforces
//   2. functions/api/*.ts        — the handlers' payload fields and limits
//   3. db/schema.sql             — the D1 tables the handlers INSERT into
//
// A field added to the handler but not the OpenAPI schema gets blocked at the
// edge once API Shield moves to Block mode; an INSERT column missing from the
// schema fails at runtime in production. Both drift classes fail here instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(siteRoot, file), 'utf8');

const failures = [];
const fail = (message) => failures.push(message);

// --- 1. OpenAPI schema <-> contact handler ---------------------------------

const openapi = JSON.parse(read('db/contact-openapi.json'));
const submission = openapi.components?.schemas?.ContactSubmission;
if (!submission) {
  fail('db/contact-openapi.json has no components.schemas.ContactSubmission');
} else {
  const contactSrc = read('functions/api/contact.ts');

  const payloadBlock = contactSrc.match(/interface ContactPayload \{([\s\S]*?)\}/)?.[1] ?? '';
  const handlerFields = [...payloadBlock.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1]).sort();
  const schemaFields = Object.keys(submission.properties ?? {}).sort();
  if (handlerFields.join() !== schemaFields.join()) {
    fail(`payload fields differ: handler has [${handlerFields}], OpenAPI schema has [${schemaFields}]`);
  }

  const schemaRequired = [...(submission.required ?? [])].sort();
  const expectedRequired = ['email', 'message', 'name', 'turnstileToken'];
  if (schemaRequired.join() !== expectedRequired.join()) {
    fail(`OpenAPI required fields are [${schemaRequired}], expected [${expectedRequired}]`);
  }
  if (!/!name \|\| !email \|\| !message/.test(contactSrc) || !/!turnstileToken/.test(contactSrc)) {
    fail('contact.ts no longer rejects the required fields the OpenAPI schema declares');
  }

  const handlerLimit = (field) =>
    Number(contactSrc.match(new RegExp(`${field}\\.length > (\\d+)`))?.[1]);
  const schemaMax = (field) => submission.properties?.[field]?.maxLength;
  for (const field of ['name', 'email', 'message']) {
    if (handlerLimit(field) !== schemaMax(field)) {
      fail(`${field} maxLength differs: handler caps at ${handlerLimit(field)}, OpenAPI says ${schemaMax(field)}`);
    }
  }

  const sourceUrlCap = Number(
    contactSrc.match(/MAX_SOURCE_URL_LENGTH = ([\d_]+)/)?.[1]?.replaceAll('_', ''),
  );
  if (sourceUrlCap !== schemaMax('sourceUrl')) {
    fail(`sourceUrl cap differs: handler truncates at ${sourceUrlCap}, OpenAPI says ${schemaMax('sourceUrl')}`);
  }
}

// --- 2. Handler INSERTs <-> D1 schema ---------------------------------------

const sql = read('db/schema.sql');
const tables = new Map();
for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  const columns = match[2]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'))
    .map((line) => line.split(/\s+/)[0]);
  tables.set(match[1], new Set(columns));
}
if (tables.size === 0) fail('db/schema.sql defines no CREATE TABLE statements');

let insertCount = 0;
for (const file of fs.readdirSync(path.join(siteRoot, 'functions/api'))) {
  if (!file.endsWith('.ts')) continue;
  const source = read(path.join('functions/api', file));

  for (const match of source.matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)[\s\S]*?VALUES\s*\(([^)]+)\)/g)) {
    insertCount += 1;
    const [, table, columnList, valueList] = match;
    const columns = columnList.split(',').map((column) => column.trim());
    const placeholders = valueList.split(',').length;

    if (!tables.has(table)) {
      fail(`functions/api/${file} inserts into "${table}", which db/schema.sql does not define`);
      continue;
    }
    for (const column of columns) {
      if (!tables.get(table).has(column)) {
        fail(`functions/api/${file} inserts column "${column}" missing from ${table} in db/schema.sql`);
      }
    }
    if (placeholders !== columns.length) {
      fail(`functions/api/${file}: INSERT into ${table} binds ${placeholders} values for ${columns.length} columns`);
    }
  }
}
if (insertCount === 0) fail('no INSERT statements found in functions/api — the parser or the handlers changed shape');

if (failures.length > 0) {
  console.error('check-functions-parity: the serverless boundary disagrees with its schemas:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`ok       OpenAPI fields/limits and ${insertCount} D1 inserts agree with the handlers`);
