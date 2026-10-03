#!/usr/bin/env node
// Draft a one-sentence cover_alt for a writeup using Claude's multimodal API.
// Takes a writeup slug, reads the cover image referenced in vault frontmatter,
// sends the image to Claude, and prints the proposed alt text.
//
// Usage:
//   node bin/draft-cover-alt.ts <slug>
//   node bin/draft-cover-alt.ts <slug> --apply        # write through MCP
//   node bin/draft-cover-alt.ts --all                 # draft for every published writeup missing alt
//
// Requires ANTHROPIC_API_KEY in the environment.

import fs from 'node:fs';
import path from 'node:path';
import { WRITEUPS_FOLDER, vaultRoot as vaultRootFor } from './lib/local-paths.ts';
import { parseFrontmatter } from '../src/lib/frontmatter.ts';
import { cli } from './lib/args.ts';

const vaultRoot = vaultRootFor();
const writeupsRoot = path.join(vaultRoot, WRITEUPS_FOLDER);

const usage = 'usage: node bin/draft-cover-alt.ts <slug> [--apply]\n   or: node bin/draft-cover-alt.ts --all [--apply]';
const { values, positionals } = cli({
  usage,
  options: { all: { type: 'boolean', default: false }, apply: { type: 'boolean', default: false } },
  allowPositionals: true,
});
const { all, apply } = values;
const [slug] = positionals;

if (!slug && !all) {
  console.error(usage);
  process.exit(2);
}

const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
if (!apiKey) {
  console.error('draft-cover-alt: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

function mediaTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

export type Draft =
  | { slug: string; error: string }
  | { slug: string; skipped: string }
  | { slug: string; draft: string };

async function draftFor(slug: string): Promise<Draft> {
  const indexFile = path.join(writeupsRoot, slug, 'index.md');
  if (!fs.existsSync(indexFile)) {
    return { slug, error: 'index.md missing' };
  }
  const text = fs.readFileSync(indexFile, 'utf8');
  const { data: fm } = parseFrontmatter(text);
  const cover = typeof fm.cover_image === 'string' ? fm.cover_image : undefined;
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
    `Title: ${String(fm.title ?? slug)}`,
    `Description: ${String(fm.description ?? '(none)')}`,
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
  const result = (await response.json()) as { content?: { type: string; text?: string }[] } | null;
  const draft = result?.content?.find?.((c) => c.type === 'text')?.text?.trim() ?? '';
  return { slug, draft };
}

async function applyViaMcp(slug: string, draft: string): Promise<void> {
  // The MCP CLI doesn't expose update_writeup_frontmatter directly from the
  // shell, so writing through MCP requires Claude Code. This script prints
  // the call shape the operator can paste into a Claude session.
  console.log(`\n# To apply via MCP, paste into Claude Code:`);
  const escaped = draft.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  console.log(`# mcp__severino-vault-mcp__update_writeup_frontmatter(slug="${slug}", cover_alt="${escaped}")`);
}

const slugsToProcess: string[] = [];
if (all) {
  for (const entry of fs.readdirSync(writeupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    slugsToProcess.push(entry.name);
  }
} else if (slug) {
  slugsToProcess.push(slug);
}

for (const target of slugsToProcess) {
  const result = await draftFor(target);
  if ('error' in result) {
    console.error(`${target}: ${result.error}`);
    continue;
  }
  if ('skipped' in result) {
    console.log(`${target}: ${result.skipped}`);
    continue;
  }
  console.log(`\n${target}`);
  console.log(`  ${result.draft}`);
  if (apply) await applyViaMcp(target, result.draft);
}
