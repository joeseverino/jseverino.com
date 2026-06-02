#!/usr/bin/env node
// Draft a one-sentence cover_alt for a writeup using Claude's multimodal API.
// Takes a writeup slug, reads the cover image referenced in vault frontmatter,
// sends the image to Claude, and prints the proposed alt text.
//
// Usage:
//   node bin/draft-cover-alt.mjs <slug>
//   node bin/draft-cover-alt.mjs <slug> --apply        # write through MCP
//   node bin/draft-cover-alt.mjs --all                 # draft for every published writeup missing alt
//
// Requires ANTHROPIC_API_KEY in the environment.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot =
  process.env.VAULT_DIR
    ? path.resolve(process.env.VAULT_DIR)
    : path.resolve(siteRoot, '../../Severino Labs');
const writeupsRoot = path.join(vaultRoot, '05 Writeups');

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const all = args.includes('--all');
const apply = args.includes('--apply');

if (!slug && !all) {
  console.error('Usage: node bin/draft-cover-alt.mjs <slug> [--apply]');
  console.error('   or: node bin/draft-cover-alt.mjs --all [--apply]');
  process.exit(2);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('draft-cover-alt: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?)\s*$/);
    if (m) data[m[1]] = m[2];
  }
  return data;
}

function mediaTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

async function draftFor(slug) {
  const indexFile = path.join(writeupsRoot, slug, 'index.md');
  if (!fs.existsSync(indexFile)) {
    return { slug, error: 'index.md missing' };
  }
  const text = fs.readFileSync(indexFile, 'utf8');
  const fm = parseFrontmatter(text);
  const cover = fm.cover_image;
  if (!cover) return { slug, error: 'cover_image not set' };
  if (fm.cover_alt) return { slug, skipped: 'cover_alt already set' };

  const imagePath = cover.startsWith('./')
    ? path.join(writeupsRoot, slug, cover.slice(2))
    : path.join(writeupsRoot, slug, cover);
  if (!fs.existsSync(imagePath)) {
    return { slug, error: `cover image not found: ${imagePath}` };
  }

  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const mediaType = mediaTypeFor(imagePath);

  const prompt = [
    `Title: ${fm.title ?? slug}`,
    `Description: ${fm.description ?? '(none)'}`,
    '',
    'Write one factual sentence describing what is visible in the image. The sentence will be used as the alt attribute on a portfolio listing card and on the article hero. Constraints:',
    '- Describe the image content, not the writeup topic.',
    '- Include concrete details visible in the image (dashboard names, tool labels, command names, diagram labels).',
    '- No marketing language. No "this image shows", "screenshot of", "depicts".',
    '- One sentence, under 220 characters.',
    '- End with a period.',
  ].join('\n');

  const body = {
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { slug, error: `Anthropic API ${response.status}: ${await response.text()}` };
  }
  const result = await response.json();
  const draft = result?.content?.find?.((c) => c.type === 'text')?.text?.trim() ?? '';
  return { slug, draft };
}

async function applyViaMcp(slug, draft) {
  // The MCP CLI doesn't expose update_writeup_frontmatter directly from the
  // shell, so writing through MCP requires Claude Code. This script prints
  // the call shape the operator can paste into a Claude session.
  console.log(`\n# To apply via MCP, paste into Claude Code:`);
  console.log(`# mcp__severino-vault-mcp__update_writeup_frontmatter(slug="${slug}", cover_alt="${draft.replace(/"/g, '\\"')}")`);
}

const slugsToProcess = [];
if (all) {
  for (const entry of fs.readdirSync(writeupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    slugsToProcess.push(entry.name);
  }
} else {
  slugsToProcess.push(slug);
}

for (const target of slugsToProcess) {
  const result = await draftFor(target);
  if (result.error) {
    console.error(`${target}: ${result.error}`);
    continue;
  }
  if (result.skipped) {
    console.log(`${target}: ${result.skipped}`);
    continue;
  }
  console.log(`\n${target}`);
  console.log(`  ${result.draft}`);
  if (apply) await applyViaMcp(target, result.draft);
}
