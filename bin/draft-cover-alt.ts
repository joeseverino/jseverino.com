// Draft a one-sentence cover_alt for a writeup's cover image with Claude's API.

import fs from 'node:fs';
import path from 'node:path';
import { cli, flag, usageError } from './lib/args.ts';
import { updateFrontmatter } from './site/writeup-store/plan.ts';
import { loadWriteups, type Writeup, writeupStore } from './site/writeup-store/store.ts';

const usage = `usage: node bin/draft-cover-alt.ts <slug> [--apply]
   or: node bin/draft-cover-alt.ts --all [--apply]

Prints the draft. Reads ANTHROPIC_API_KEY, and CLAUDE_MODEL when set.

  --all    Draft for every published writeup with no cover_alt.
  --apply  Write the draft to the writeup's cover_alt.`;
const { values, positionals } = cli({
  usage,
  options: { all: flag, apply: flag },
  allowPositionals: true,
});
const { all, apply } = values;
const [slug] = positionals;

if (!slug && !all) usageError(usage);

const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
if (!apiKey) {
  console.error('draft-cover-alt: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5-5';

// The image types the Messages API accepts.
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

type Draft = { error: string } | { skipped: string } | { draft: string };

async function draftFor(writeup: Writeup): Promise<Draft> {
  if (all && !writeup.published) return { skipped: 'not published' };
  if (!writeup.cover_image) return { error: 'cover_image not set' };
  if (writeup.cover_alt) return { skipped: 'cover_alt already set' };

  const imagePath = path.join(path.dirname(writeup.path), writeup.cover_image);
  if (!fs.existsSync(imagePath)) return { error: `cover image not found: ${imagePath}` };
  const mediaType = MEDIA_TYPES[path.extname(imagePath).toLowerCase()] ?? 'application/octet-stream';

  const prompt = [
    `Title: ${writeup.title}`,
    `Description: ${writeup.description || '(none)'}`,
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
    max_tokens: 2048,
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: fs.readFileSync(imagePath).toString('base64') } },
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { error: `Anthropic API ${response.status}: ${await response.text()}` };
  const result = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] } | null;
  const draft = result?.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
  if (result?.stop_reason !== 'end_turn' || !draft) {
    return { error: `no usable draft (stop_reason ${result?.stop_reason ?? 'missing'})` };
  }
  return { draft };
}

const store = writeupStore();
const writeups = loadWriteups(store);
const targets = all ? writeups : writeups.filter((writeup) => writeup.slug === slug);

let failed = 0;
if (!all && targets.length === 0) {
  console.error(`${slug}: no writeup with this slug`);
  failed = 1;
}
for (const writeup of targets) {
  const target = writeup.slug;
  const result: Draft = await draftFor(writeup).catch((error: unknown) => ({ error: String(error) }));
  if ('error' in result) {
    console.error(`${target}: ${result.error}`);
    failed += 1;
    continue;
  }
  if ('skipped' in result) {
    console.log(`${target}: ${result.skipped}`);
    continue;
  }
  console.log(`\n${target}`);
  console.log(`  ${result.draft}`);
  if (apply) {
    const { noOp } = updateFrontmatter(store, target, { cover_alt: result.draft });
    console.log(noOp ? `unchanged ${target}: cover_alt already matches` : `applied  ${target}: cover_alt`);
  }
}
if (failed) process.exitCode = 1;
