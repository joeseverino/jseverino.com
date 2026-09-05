#!/usr/bin/env node
// CI's first job. Runs the registry audits that claim the 'gate' gate: the
// fast pre-build invariants (source parse, repository policy, docs integrity,
// stylesheet lint) that should fail before build, e2e, and visual spend three
// runners. Collect-all, so one report names every broken invariant, with the
// same one-line summaries publish:check prints for the same audits.
import { auditsFor } from '../tests/audits/registry.mjs';
import { firstFailureLine, summarize } from './lib/audit-summary.mjs';
import { run, status } from './lib/run.mjs';
import { annotate, appendSummary, endGroup, group, inActions, outcome, table } from './lib/step-summary.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const rows = [];

for (const audit of auditsFor('gate')) {
  if (audit.localOnly && process.env.CI) {
    const detail = 'skipped (verifies sources that only exist on the authoring machine)';
    rows.push([audit.label, null, detail]);
    status(audit.label, detail);
    continue;
  }

  group(`${audit.label.padEnd(12)} ${audit.name}`);
  const result = await run(audit.exec.cmd, audit.exec.args, {
    cwd: siteRoot,
    env: audit.exec.env,
    timeout: audit.timeout,
  });
  // Full output lives inside the collapsed group in Actions; locally the
  // one-line status is the whole story unless the audit failed.
  if (inActions && result.output.trim()) console.log(result.output.trimEnd());
  endGroup();

  if (result.code === 0) {
    const detail = summarize(audit, result.output);
    rows.push([audit.label, true, detail]);
    status(audit.label, detail);
    continue;
  }

  const reason = firstFailureLine(result.output);
  rows.push([audit.label, false, reason]);
  status(audit.label, `FAILED: ${reason}`);
  annotate('error', `gate: ${audit.label}`, `${reason}. ${audit.fix}`);
  if (!inActions && result.output.trim()) console.error(result.output.trimEnd());
}

const failed = rows.filter(([, ok]) => ok === false);
appendSummary([
  '## Gate',
  '',
  failed.length === 0
    ? `All ${rows.length} pre-build audits passed.`
    : `${failed.length} of ${rows.length} pre-build audits failed.`,
  '',
  table(['Audit', 'Result', 'Detail'], rows.map(([label, ok, detail]) => [`\`${label}\``, outcome(ok), detail])),
].join('\n'));

if (failed.length > 0) {
  console.error(`\nfailed: ${failed.map(([label]) => label).join(', ')}`);
  process.exit(1);
}

console.log(`\nok gate: ${rows.length} pre-build audits passed`);
