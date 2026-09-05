#!/usr/bin/env node
// Contract lineage across the serverless boundary. The request shape is
// declared once in contracts/contact.v1.json; OpenAPI and the handler derive
// from it. D1 remains a persistence contract and is checked against INSERTs.

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.mjs';

const read = (file) => fs.readFileSync(path.join(siteRoot, file), 'utf8');

const failures = [];
const fail = (message) => failures.push(message);

// --- 1. Canonical request contract -> OpenAPI + handler ---------------------

const contract = JSON.parse(read('contracts/contact.v1.json'));
const openapi = JSON.parse(read('db/contact-openapi.json'));
const submission = openapi.components?.schemas?.ContactSubmission;
if (!submission) {
  fail('db/contact-openapi.json has no components.schemas.ContactSubmission');
} else {
  if (JSON.stringify(submission) !== JSON.stringify(contract.request)) {
    fail('OpenAPI ContactSubmission is stale; run npm run sync:contact-openapi');
  }
  const contactSrc = read('functions/api/contact.ts');
  if (!contactSrc.includes('validateContactPayload(payload)')) {
    fail('contact handler does not validate through the canonical contract adapter');
  }
  if (/interface ContactPayload|MAX_SOURCE_URL_LENGTH|name\.length\s*>/.test(contactSrc)) {
    fail('contact handler has reintroduced a second request schema or field limit');
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

console.log(`ok       contact contract drives OpenAPI/handler; ${insertCount} D1 inserts match storage`);
