#!/usr/bin/env node
// Assert that the writeup frontmatter schema documented in the vault matches
// the fields the vault MCP's `update_writeup_frontmatter` tool accepts, the
// flags its `update-writeup` CLI subcommand forwards, what
// `src/content.config.ts` (Zod) accepts, and what the `site manage` TUI
// (tools repo) exposes for editing. Fails on drift.
//
// Drift like the cover_alt gap (vault MCP missing a field the Zod schema
// already accepted, or vice versa) is exactly what this catches — and the
// TUI layer catches a scaffolded field that every backend accepts but the
// interactive editor silently can't touch. The CLI layer matters because the
// TUI saves through it: a field added to the tool and the TUI but not the
// argparse table fails only at save time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vaultRoot =
  process.env.VAULT_DIR
    ? path.resolve(process.env.VAULT_DIR)
    : path.resolve(siteRoot, '../../Severino Labs');
const mcpRoot =
  process.env.MCP_DIR
    ? path.resolve(process.env.MCP_DIR)
    : path.resolve(siteRoot, '../../Assets/severino-vault-mcp');

const toolsRoot =
  process.env.TOOLS_DIR
    ? path.resolve(process.env.TOOLS_DIR)
    : path.resolve(siteRoot, '../../Assets/tools');

const schemaDoc = path.join(vaultRoot, '02 Infrastructure/Severino HQ/Frontmatter Schema.md');
const zodConfig = path.join(siteRoot, 'src/content.config.ts');
const mcpServer = path.join(mcpRoot, 'src/severino_vault_mcp/server.py');
const mcpCli = path.join(mcpRoot, 'src/severino_vault_mcp/__main__.py');
const tuiSource = path.join(toolsRoot, 'lib/site/manage-tui.mjs');

// Fields that intentionally aren't user-settable through the per-field MCP
// tool (managed by the publish-gate, batch-only, or vault-only metadata).
const MCP_EXCLUDED = new Set(['touch_last_reviewed', 'technologies']);

// Vault-only fields. They're documented in the schema doc but never sync to
// the public site (Zod) or surface in the per-field MCP tool.
const VAULT_ONLY = new Set(['doc_id', 'related_projects', 'related_assets']);

// Fields the CLI manages through the dedicated reorder-featured subcommand
// (which keeps featured_order sequential 1..N) rather than raw update-writeup
// flags. The MCP tool accepts them for agent use; the CLI deliberately
// doesn't offer a second, unsequenced write path.
const CLI_MANAGED = new Set(['featured', 'featured_order']);

// Fields the TUI manages through dedicated interactions rather than editable
// field rows: `published` is the p key, featured/featured_order are the
// move/feature reordering of the list itself.
const TUI_MANAGED = new Set(['published', 'featured', 'featured_order']);

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

function parseCliUpdateFlags(text) {
  const start = text.indexOf('"update-writeup"');
  if (start === -1) fail('MCP __main__.py is missing the update-writeup subcommand');
  const end = text.indexOf('args = parser.parse_args()', start);
  const block = text.slice(start, end === -1 ? text.length : end);
  const fields = new Set();
  for (const match of block.matchAll(/add_argument\("--([a-z][a-z-]*)"/g)) {
    const name = match[1].replaceAll('-', '_');
    if (name === 'pretty') continue;
    if (MCP_EXCLUDED.has(name)) continue;
    fields.add(name);
  }
  if (fields.size === 0) fail('MCP __main__.py update-writeup parsed to zero field flags');
  return fields;
}

function parseTuiFields(text) {
  const start = text.indexOf('const FIELDS = [');
  if (start === -1) fail('manage-tui.mjs is missing the FIELDS table');
  const end = text.indexOf('];', start);
  const block = text.slice(start, end);
  const editable = new Set();
  const readOnly = new Set();
  for (const match of block.matchAll(/label:\s*'([a-z_]+)'.*?editable:\s*(true|false)/g)) {
    (match[2] === 'true' ? editable : readOnly).add(match[1]);
  }
  if (editable.size === 0) fail('manage-tui.mjs FIELDS table parsed to zero editable fields');
  return { editable, readOnly };
}

function diff(label, expected, actual) {
  const missing = [...expected].filter((field) => !actual.has(field)).sort();
  const extra = [...actual].filter((field) => !expected.has(field)).sort();
  return { label, missing, extra };
}

const schemaFields = parseSchemaDocWriteupFields(fs.readFileSync(schemaDoc, 'utf8'));
const zodFields = parseZodWriteupFields(fs.readFileSync(zodConfig, 'utf8'));
const mcpFields = parseMcpUpdateFields(fs.readFileSync(mcpServer, 'utf8'));
const cliFields = parseCliUpdateFlags(fs.readFileSync(mcpCli, 'utf8'));
const tuiFields = parseTuiFields(fs.readFileSync(tuiSource, 'utf8'));

// The schema doc carries vault-only fields that intentionally don't reach
// the site or the per-field MCP tool. Subtract them before comparing.
const expectedForZod = new Set([...schemaFields].filter((f) => !VAULT_ONLY.has(f)));
const expectedForMcp = new Set(
  [...schemaFields].filter((f) => !VAULT_ONLY.has(f) && !MCP_EXCLUDED.has(f)),
);

const expectedForTui = new Set([...expectedForMcp].filter((f) => !TUI_MANAGED.has(f)));

const zodGap = diff('Zod schema (src/content.config.ts)', expectedForZod, zodFields);
const mcpGap = diff('MCP update_writeup_frontmatter', expectedForMcp, mcpFields);
const expectedForCli = new Set([...expectedForMcp].filter((f) => !CLI_MANAGED.has(f)));
const cliGap = diff('MCP update-writeup CLI flags (__main__.py)', expectedForCli, cliFields);
const tuiGap = diff('site manage TUI editable fields (tools repo)', expectedForTui, tuiFields.editable);

let failed = false;

// A TUI display-only row pointing at a field the schema doc no longer has is
// a ghost — catch renames that left the editor behind.
const tuiGhosts = [...tuiFields.readOnly].filter((f) => !schemaFields.has(f)).sort();
if (tuiGhosts.length > 0) {
  failed = true;
  console.error(`site manage TUI shows fields not in vault schema doc: ${tuiGhosts.join(', ')}`);
}

for (const gap of [zodGap, mcpGap, cliGap, tuiGap]) {
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
console.log(`ok       schema/Zod/MCP/CLI/TUI agree on writeup fields: ${sharedFields}`);
