#!/usr/bin/env node
// Render the generated blocks in docs/Commands.md, between their markers: the npm
// scripts from bin/help.ts and the mise tasks from `mise tasks`.
//
//   node bin/sync-docs.ts            # rewrite the blocks in place
//   node bin/sync-docs.ts --check    # exit 1 if any block is stale
import fs from 'node:fs';
import { fromRoot } from '../src/lib/site-root.ts';
import { checkMode } from './lib/args.ts';
import { miseTasks } from './lib/mise.ts';
import { writeOrCheck } from './lib/projection.ts';
import { table } from './lib/step-summary.ts';
import { groupedScripts } from './help.ts';
import { packageScripts } from '../src/lib/json.ts';

const check = checkMode('usage: node bin/sync-docs.ts [--check]');

function commandOverview(): string {
  return groupedScripts(packageScripts())
    .map((group) => `### ${group.title}\n\n${table(['Command', 'Does'], group.rows.map(([name, desc]) => [`\`npm run ${name}\``, desc]))}`)
    .join('\n\n');
}

function taskOverview(): string {
  const alias = (aliases: readonly string[]): string => (aliases.length ? ` (also \`mise run ${aliases.join('`, `mise run ')}\`)` : '');
  return table(['Task', 'Asserts or does'], miseTasks().map((task) => [`\`mise run ${task.name}\`${alias(task.aliases)}`, task.description]));
}

const BLOCKS: Record<string, Record<string, () => string>> = {
  'docs/Commands.md': { 'command-overview': commandOverview, 'task-overview': taskOverview },
};

function render(file: string, blocks: Record<string, () => string>): string {
  let text = fs.readFileSync(fromRoot(file), 'utf8');
  for (const [name, produce] of Object.entries(blocks)) {
    const block = new RegExp(`(<!-- generated:start ${name} [^\\n]*-->\\n)[\\s\\S]*?(<!-- generated:end ${name} -->)`);
    if (!block.test(text)) throw new Error(`${file} has no "${name}" generated-block markers`);
    text = text.replace(block, (_, start, end) => `${start}\n${produce()}\n\n${end}`);
  }
  return text;
}

writeOrCheck(
  Object.entries(BLOCKS).map(([file, blocks]) => ({ file: fromRoot(file), content: render(file, blocks) })),
  { check, hint: 'npm run sync:docs' },
);
if (check) console.log(`ok       generated blocks in ${Object.keys(BLOCKS).join(' and ')} match their sources`);
