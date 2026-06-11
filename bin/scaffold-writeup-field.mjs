#!/usr/bin/env node
// Scaffold a new writeup frontmatter field across the 5 mechanical sites:
//
//   1. Vault Frontmatter Schema.md (Writeups slim variant)
//   2. src/content.config.ts (Zod schema)
//   3. bin/sync-content.mjs (publicWriteupData allowlist)
//   4. src/lib/content.ts (Writeup type + getWriteups mapping)
//   5. MCP writeups.py (Writeup dataclass + load_writeups)
//   6. MCP server.py (update_writeup_frontmatter signature + candidates)
//
// Dry-run by default — prints proposed unified diffs. Pass --apply to write.
//
// Usage:
//   node bin/scaffold-writeup-field.mjs --name archive_url --description "Archive URL for the published version"
//   node bin/scaffold-writeup-field.mjs --name archive_url --description "..." --apply
//
// Scope: scalar string fields with an optional value. For booleans/lists,
// hand-edit afterward (the structural patches still apply).

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

function flag(name, fallback) {
  const args = process.argv.slice(2);
  const i = args.findIndex((a) => a === `--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const apply = process.argv.includes('--apply');
const fieldName = flag('name');
const description = flag('description', '');
if (!fieldName || !/^[a-z][a-z0-9_]*$/.test(fieldName)) {
  console.error('scaffold-writeup-field: --name required, must be snake_case');
  process.exit(2);
}

const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const titleHint = description || `${fieldName} content`;

const edits = [
  {
    file: path.join(vaultRoot, '02 Infrastructure/Severino HQ/Frontmatter Schema.md'),
    anchor: /technologies:\s*\n  - tailscale/,
    insertBefore: `${fieldName}: ${titleHint}  # added by scaffold-writeup-field\n`,
    note: 'vault frontmatter schema (writeups slim variant)',
  },
  {
    file: path.join(siteRoot, 'src/content.config.ts'),
    anchor: /technologies: z\.array\(z\.string\(\)\)\.default\(\[\]\),/,
    insertBefore: `    ${fieldName}: z.string().optional(),\n`,
    note: 'Zod schema in src/content.config.ts',
  },
  {
    file: path.join(siteRoot, 'bin/sync-content.mjs'),
    anchor: /technologies: Array\.isArray\(data\.technologies\) \? data\.technologies : \[\],/,
    insertBefore: `    ...(data.${fieldName} ? { ${fieldName}: data.${fieldName} } : {}),\n`,
    note: 'sync-content.mjs publicWriteupData allowlist',
  },
  {
    file: path.join(siteRoot, 'src/lib/content.ts'),
    anchor: /heroImage: string;/,
    insertAfter: `\n  ${camelName}?: string;`,
    note: 'Writeup type in src/lib/content.ts (manual: add to getWriteups mapping)',
  },
  {
    file: path.join(mcpRoot, 'src/severino_vault_mcp/writeups.py'),
    anchor: /technologies: list\[str\]/,
    insertBefore: `    ${fieldName}: str | None\n`,
    note: 'MCP Writeup dataclass',
  },
  {
    file: path.join(mcpRoot, 'src/severino_vault_mcp/writeups.py'),
    anchor: /technologies=_coerce_str_list\(fm\.get\("technologies"\)\),/,
    insertBefore: `                ${fieldName}=_coerce_optional_str(fm.get("${fieldName}")),\n`,
    note: 'MCP load_writeups',
  },
  {
    file: path.join(mcpRoot, 'src/severino_vault_mcp/server.py'),
    anchor: /featured: bool \| None = None,\n {4}featured_order: int \| None = None,/,
    insertBefore: `    ${fieldName}: str | None = None,\n`,
    note: 'MCP update_writeup_frontmatter signature',
  },
  {
    file: path.join(mcpRoot, 'src/severino_vault_mcp/server.py'),
    anchor: /\("featured", writeup\.featured, featured\),/,
    insertBefore: `        ("${fieldName}", writeup.${fieldName}, ${fieldName}),\n`,
    note: 'MCP update_writeup_frontmatter candidates',
  },
];

function unifiedDiffSnippet(beforeLine, insertedLine, file) {
  const rel = path.relative(process.cwd(), file);
  return [
    `--- ${rel}`,
    `+++ ${rel}`,
    `@@`,
    `+${insertedLine.trimEnd()}`,
    ` ${beforeLine.trimEnd()}`,
    '',
  ].join('\n');
}

let anyMissing = false;
let appliedCount = 0;

for (const edit of edits) {
  if (!fs.existsSync(edit.file)) {
    console.error(`scaffold-writeup-field: missing target ${edit.file} (${edit.note})`);
    anyMissing = true;
    continue;
  }
  const text = fs.readFileSync(edit.file, 'utf8');
  const match = text.match(edit.anchor);
  if (!match) {
    console.error(
      `scaffold-writeup-field: anchor not found in ${path.relative(process.cwd(), edit.file)} (${edit.note}). Hand-edit needed.`,
    );
    anyMissing = true;
    continue;
  }
  const anchored = match[0];
  let patched;
  if (edit.insertBefore) {
    patched = text.replace(anchored, `${edit.insertBefore}${anchored}`);
  } else {
    patched = text.replace(anchored, `${anchored}${edit.insertAfter}`);
  }
  if (apply) {
    fs.writeFileSync(edit.file, patched);
    console.log(`patched: ${path.relative(process.cwd(), edit.file)} — ${edit.note}`);
    appliedCount += 1;
  } else {
    console.log(unifiedDiffSnippet(anchored, edit.insertBefore ?? edit.insertAfter, edit.file));
  }
}

if (!apply) {
  console.log('--- dry run; re-run with --apply to write ---');
}
if (anyMissing) {
  process.exit(1);
}

console.log('');
console.log('Manual follow-up:');
console.log(
  `  - Map entry.data.${fieldName} → writeup.${camelName} inside getWriteups() in src/lib/content.ts`,
);
console.log(`  - Surface ${camelName} in any component that should render it`);
console.log(
  `  - Add a '${fieldName}' row to FIELDS in the site manage TUI (tools repo, lib/site/manage-tui.mjs) — check:parity fails until it can edit the field`,
);
console.log('  - Update docs/SEO.md, docs/Vault-Workflow.md, docs/Architecture.md field lists');
console.log('  - Update MCP README, CHANGELOG, docs/ai-safety-security.md tool descriptions');
console.log('  - cd ~/Documents/Code/Assets/severino-vault-mcp && uv tool install --reinstall .');
console.log('  - /mcp Reconnect in Claude Code so the new tool param is visible');
console.log('  - Populate the field for existing writeups via update_writeup_frontmatter');
console.log('  - npm run sync:content; npm run check; npm run build:static');
console.log('');
if (apply) {
  console.log(`ok       ${appliedCount} edits applied`);
}
