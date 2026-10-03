#!/usr/bin/env node
// The site owns one machine-readable content contract. Runtime adapters derive
// from it; the MCP carries a fingerprinted projection for offline installs.

import fs from 'node:fs';
import path from 'node:path';
import { vaultMcpRoot } from '../../bin/lib/local-paths.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import {
  contentContract,
  contentContractFingerprint,
} from '../../src/lib/content-contract.ts';
import { readJson } from '../../src/lib/json.ts';
import { abort } from './lib.ts';

const mcpRoot = vaultMcpRoot();

const fail: (message: string) => never = (message) => abort('check-vault-mcp-parity', message);

const writeupFields = contentContract.collections?.writeups?.fields;
if (!writeupFields || Object.keys(writeupFields).length === 0) {
  fail('canonical writeup contract has no fields');
}

const contentConfig = fs.readFileSync(path.join(root, 'src/content.config.ts'), 'utf8');
const syncSource = fs.readFileSync(path.join(root, 'bin/content-sync/sync.ts'), 'utf8');
const generatedSchema = fs.readFileSync(path.join(root, 'src/generated/content-schema.ts'), 'utf8');
const publicProjection = fs.readFileSync(path.join(root, 'bin/content-sync/public-projection.ts'), 'utf8');
if (!contentConfig.includes("from './generated/content-schema.ts'")) {
  fail('Astro writeup schema does not derive from the canonical contract');
}
if (!generatedSchema.includes(`Contract fingerprint: ${contentContractFingerprint()}`)) {
  fail('generated Astro schema fingerprint is stale; run npm run sync:contract');
}
if (!syncSource.includes('projection.writeup(') || !publicProjection.includes("projectFrontmatter('writeups'")) {
  fail('public writeup projection does not derive from the canonical contract');
}

const projectionPath = path.join(
  mcpRoot,
  'src/severino_vault_mcp/contracts/site_content.v1.json',
);
if (fs.existsSync(mcpRoot)) {
  if (!fs.existsSync(projectionPath)) fail(`MCP projection missing: ${projectionPath}`);
  const projection: { fingerprint?: unknown; contract?: unknown } = readJson(projectionPath);
  if (projection.fingerprint !== contentContractFingerprint()) {
    fail('MCP content projection fingerprint is stale; run npm run sync:contract');
  }
  if (JSON.stringify(projection.contract) !== JSON.stringify(contentContract)) {
    fail('MCP content projection differs from the canonical contract');
  }
  const cli = fs.readFileSync(path.join(mcpRoot, 'src/severino_vault_mcp/cli.py'), 'utf8');
  const tools = fs.readFileSync(
    path.join(mcpRoot, 'src/severino_vault_mcp/tools/writeups.py'),
    'utf8',
  );
  if (!cli.includes('cli_fields()')) fail('MCP CLI flags are not contract-derived');
  if (!tools.includes('update_tool_signature()')) {
    fail('MCP tool signature is not contract-derived');
  }
}

const tui = fs.readFileSync(path.join(root, 'bin/site/manage-model.ts'), 'utf8');
if (!tui.includes("collectionFields('writeups')")) {
  fail('site manage does not read its fields from the content contract');
}
if (/const FIELDS\s*=\s*\[/.test(tui)) {
  fail('site manage hardcodes its field registry');
}

console.log(
  `ok       one content contract drives Astro/public/MCP/CLI/TUI (${contentContractFingerprint().slice(0, 12)})`,
);
