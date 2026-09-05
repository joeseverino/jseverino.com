#!/usr/bin/env node
// Generated documentation blocks. The command overview in docs/Commands.md and
// the gate-coverage table in tests/ARCHITECTURE.md are projections of
// bin/help.mjs and tests/audits/registry.mjs; this renders them between their
// markers so the docs cannot drift from the code they describe.
//
//   node bin/sync-docs.mjs            # rewrite the blocks in place
//   node bin/sync-docs.mjs --check    # exit 1 if any block is stale
import fs from 'node:fs';
import { fromRoot } from '../src/lib/site-root.mjs';
import { AUDITS } from '../tests/audits/registry.mjs';
import { groupedScripts } from './help.mjs';

const GATES = ['gate', 'publish', 'diagnose', 'release'];

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => ':---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

function commandOverview() {
  const { scripts } = JSON.parse(fs.readFileSync(fromRoot('package.json'), 'utf8'));
  return groupedScripts(scripts)
    .map((group) => `### ${group.title}\n\n${table(['Command', 'Does'], group.rows.map(([name, desc]) => [`\`npm run ${name}\``, desc]))}`)
    .join('\n\n');
}

function gateCoverage() {
  return table(
    ['Audit', 'Label', 'Phase', ...GATES],
    AUDITS.map((audit) => [
      audit.localOnly ? `${audit.name} (authoring machine only)` : audit.name,
      `\`${audit.label}\``,
      audit.phase,
      ...GATES.map((gate) => (audit.gates.includes(gate) ? '✓' : '')),
    ]),
  );
}

const BLOCKS = {
  'docs/Commands.md': { 'command-overview': commandOverview },
  'tests/ARCHITECTURE.md': { 'gate-coverage': gateCoverage },
};

function render(file, blocks) {
  let text = fs.readFileSync(fromRoot(file), 'utf8');
  for (const [name, produce] of Object.entries(blocks)) {
    const block = new RegExp(`(<!-- generated:start ${name} [^\\n]*-->\\n)[\\s\\S]*?(<!-- generated:end ${name} -->)`);
    if (!block.test(text)) throw new Error(`${file} has no "${name}" generated-block markers`);
    text = text.replace(block, (_, start, end) => `${start}\n${produce()}\n\n${end}`);
  }
  return text;
}

const stale = [];
for (const [file, blocks] of Object.entries(BLOCKS)) {
  const rendered = render(file, blocks);
  if (rendered === fs.readFileSync(fromRoot(file), 'utf8')) continue;
  if (process.argv.includes('--check')) {
    stale.push(file);
  } else {
    fs.writeFileSync(fromRoot(file), rendered);
    console.log(`wrote ${file}`);
  }
}

if (stale.length > 0) {
  console.error(`generated blocks are stale in ${stale.join(', ')}; run npm run sync:docs`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`ok       generated blocks in ${Object.keys(BLOCKS).join(' and ')} match their sources`);
}
