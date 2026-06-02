#!/usr/bin/env node
// Assert that the writeup frontmatter schema documented in the vault matches
// the fields the vault MCP's `update_writeup_frontmatter` tool accepts and
// what `src/content.config.ts` (Zod) accepts. Fails on drift.
//
// Drift like the cover_alt gap (vault MCP missing a field the Zod schema
// already accepted, or vice versa) is exactly what this catches.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot =
  process.env.VAULT_DIR
    ? path.resolve(process.env.VAULT_DIR)
    : path.resolve(siteRoot, '../../Severino Labs');
const mcpRoot =
  process.env.MCP_DIR
    ? path.resolve(process.env.MCP_DIR)
    : path.resolve(siteRoot, '../../Assets/severino-vault-mcp');

const schemaDoc = path.join(vaultRoot, '02 Infrastructure/Severino HQ/Frontmatter Schema.md');
const zodConfig = path.join(siteRoot, 'src/content.config.ts');
const mcpServer = path.join(mcpRoot, 'src/severino_vault_mcp/server.py');

// Fields that intentionally aren't user-settable through the per-field MCP
// tool (managed by the publish-gate, batch-only, or vault-only metadata).
const MCP_EXCLUDED = new Set(['touch_last_reviewed', 'technologies']);

// Vault-only fields. They're documented in the schema doc but never sync to
// the public site (Zod) or surface in the per-field MCP tool.
const VAULT_ONLY = new Set(['doc_id', 'related_projects', 'related_assets']);

function fail(message) {
  console.error(`check-vault-mcp-parity: ${message}`);
  process.exit(1);
}

function parseSchemaDocWriteupFields(text) {
  const start = text.indexOf('**Writeups** (');
  if (start === -1) fail('vault schema doc missing Writeups section');
  const codeStart = text.indexOf('```yaml', start);
  const codeEnd = text.indexOf('```', codeStart + 7);
  if (codeStart === -1 || codeEnd === -1) {
    fail('vault schema doc Writeups section is missing the yaml code block');
  }
  const block = text.slice(codeStart + 7, codeEnd);
  const fields = new Set();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([a-z_][a-z0-9_]*)\s*:/);
    if (match) fields.add(match[1]);
  }
  return fields;
}

function parseZodWriteupFields(text) {
  const start = text.indexOf('const writeups = defineCollection');
  if (start === -1) fail('content.config.ts is missing the writeups collection');
  const schemaStart = text.indexOf('schema: z.object({', start);
  const schemaEnd = text.indexOf('})', schemaStart);
  if (schemaStart === -1 || schemaEnd === -1) {
    fail('content.config.ts writeups schema block could not be parsed');
  }
  const block = text.slice(schemaStart, schemaEnd);
  const fields = new Set();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s+([a-z_][a-z0-9_]*)\s*:/);
    if (match) fields.add(match[1]);
  }
  return fields;
}

function parseMcpUpdateFields(text) {
  const start = text.indexOf('def update_writeup_frontmatter(');
  if (start === -1) fail('MCP server.py missing update_writeup_frontmatter');
  const sigEnd = text.indexOf(')', start);
  const signature = text.slice(start, sigEnd + 1);
  const fields = new Set();
  for (const match of signature.matchAll(/(\b[a-z_][a-z0-9_]*)\s*:\s*[A-Za-z]/g)) {
    const name = match[1];
    if (name === 'slug') continue;
    if (MCP_EXCLUDED.has(name)) continue;
    fields.add(name);
  }
  return fields;
}

function diff(label, expected, actual) {
  const missing = [...expected].filter((field) => !actual.has(field)).sort();
  const extra = [...actual].filter((field) => !expected.has(field)).sort();
  return { label, missing, extra };
}

const schemaFields = parseSchemaDocWriteupFields(fs.readFileSync(schemaDoc, 'utf8'));
const zodFields = parseZodWriteupFields(fs.readFileSync(zodConfig, 'utf8'));
const mcpFields = parseMcpUpdateFields(fs.readFileSync(mcpServer, 'utf8'));

// The schema doc carries vault-only fields that intentionally don't reach
// the site or the per-field MCP tool. Subtract them before comparing.
const expectedForZod = new Set([...schemaFields].filter((f) => !VAULT_ONLY.has(f)));
const expectedForMcp = new Set(
  [...schemaFields].filter((f) => !VAULT_ONLY.has(f) && !MCP_EXCLUDED.has(f)),
);

const zodGap = diff('Zod schema (src/content.config.ts)', expectedForZod, zodFields);
const mcpGap = diff('MCP update_writeup_frontmatter', expectedForMcp, mcpFields);

let failed = false;
for (const gap of [zodGap, mcpGap]) {
  if (gap.missing.length > 0) {
    failed = true;
    console.error(`${gap.label}: missing fields documented in vault: ${gap.missing.join(', ')}`);
  }
  if (gap.extra.length > 0) {
    failed = true;
    console.error(`${gap.label}: accepts fields not in vault schema doc: ${gap.extra.join(', ')}`);
  }
}

if (failed) process.exit(1);

const sharedFields = [...schemaFields].sort().join(', ');
console.log(`ok       schema/Zod/MCP agree on writeup fields: ${sharedFields}`);
