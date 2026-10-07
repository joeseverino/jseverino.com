#!/usr/bin/env node
// Render the generated blocks in docs/Commands.md and tests/ARCHITECTURE.md from
// bin/help.ts and tests/audits/registry.ts, between their markers.
//
//   node bin/sync-docs.ts            # rewrite the blocks in place
//   node bin/sync-docs.ts --check    # exit 1 if any block is stale
import fs from 'node:fs';
import { fromRoot } from '../src/lib/site-root.ts';
import { AUDITS, type Audit, type Gate } from '../tests/audits/registry.ts';
import { rerunFor } from './lib/audits.ts';
import { checkMode } from './lib/args.ts';
import { writeOrCheck } from './lib/projection.ts';
import { table } from './lib/step-summary.ts';
import { groupedScripts } from './help.ts';
import { packageScripts } from '../src/lib/json.ts';

const GATES: readonly Gate[] = ['gate', 'publish', 'diagnose', 'release'];
const check = checkMode('usage: node bin/sync-docs.ts [--check]');

function commandOverview() {
  const scripts = packageScripts();
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

function auditReference() {
  const scripts = packageScripts();
  const normal = (command: string): string => command.replace(/['"]/g, '').replace(/^npx /, '');
  const scriptFor = (audit: Audit): string => {
    const command = normal([audit.exec.cmd, ...audit.exec.args].join(' '));
    const name = audit.exec.env ? undefined : Object.keys(scripts).find((key) => normal(scripts[key] ?? '') === command);
    return name ? `npm run ${name}` : rerunFor(audit);
  };
  return table(
    ['Audit', 'Asserts', 'Run alone', 'Fix'],
    AUDITS.map((audit) => {
      const script = audit.exec.args.find((arg) => arg.startsWith('tests/audits/'));
      return [
        script ? `[${audit.name}](./${script.slice('tests/'.length)})` : audit.name,
        audit.asserts,
        `\`${scriptFor(audit)}\``,
        audit.fix,
      ];
    }),
  );
}

const BLOCKS: Record<string, Record<string, () => string>> = {
  'docs/Commands.md': { 'command-overview': commandOverview },
  'tests/ARCHITECTURE.md': { 'gate-coverage': gateCoverage, 'audit-reference': auditReference },
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
