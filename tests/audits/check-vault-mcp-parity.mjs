#!/usr/bin/env node
// The site owns one machine-readable content contract. Runtime adapters derive
// from it; the MCP carries a fingerprinted projection for offline installs.

import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.mjs';
import {
  contentContract,
  contentContractFingerprint,
} from '../../src/lib/content-contract.mjs';

const root = siteRoot;
const mcpRoot = process.env.MCP_DIR
  ? path.resolve(process.env.MCP_DIR)
  : path.resolve(root, '../../Assets/severino-vault-mcp');
const toolsRoot = process.env.TOOLS_DIR
  ? path.resolve(process.env.TOOLS_DIR)
  : path.resolve(root, '../../Assets/tools');

function fail(message) {
  console.error(`check-vault-mcp-parity: ${message}`);
  process.exit(1);
}

const writeupFields = contentContract.collections?.writeups?.fields;
if (!writeupFields || Object.keys(writeupFields).length === 0) {
  fail('canonical writeup contract has no fields');
}

const contentConfig = fs.readFileSync(path.join(root, 'src/content.config.ts'), 'utf8');
const syncSource = fs.readFileSync(path.join(root, 'bin/sync-content.mjs'), 'utf8');
const generatedSchema = fs.readFileSync(path.join(root, 'src/generated/content-schema.ts'), 'utf8');
const publicProjection = fs.readFileSync(path.join(root, 'bin/content-sync/public-projection.mjs'), 'utf8');
if (!contentConfig.includes("from './generated/content-schema'")) {
  fail('Astro writeup schema does not derive from the canonical contract');
}
if (!generatedSchema.includes(`Contract fingerprint: ${contentContractFingerprint()}`)) {
  fail('generated Astro schema fingerprint is stale; run npm run sync:contract');
}
if (!syncSource.includes('publicProjection.writeup(') || !publicProjection.includes("projectFrontmatter('writeups'")) {
  fail('public writeup projection does not derive from the canonical contract');
}

const projectionPath = path.join(
  mcpRoot,
  'src/severino_vault_mcp/contracts/site_content.v1.json',
);
if (fs.existsSync(mcpRoot)) {
  if (!fs.existsSync(projectionPath)) fail(`MCP projection missing: ${projectionPath}`);
  const projection = JSON.parse(fs.readFileSync(projectionPath, 'utf8'));
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

if (fs.existsSync(toolsRoot)) {
  const tui = fs.readFileSync(path.join(toolsRoot, 'lib/site/manage-tui.mjs'), 'utf8');
  if (!tui.includes('configureFields(res.json.content_contract)')) {
    fail('site manage TUI does not consume the MCP-emitted content contract');
  }
  if (/const FIELDS\s*=\s*\[/.test(tui)) {
    fail('site manage TUI still hardcodes its field registry');
  }
}

console.log(
  `ok       one content contract drives Astro/public/MCP/CLI/TUI (${contentContractFingerprint().slice(0, 12)})`,
);
