#!/usr/bin/env node
// The first step of CI's build job. Runs the registry audits that claim the
// 'gate' gate: the fast pre-build invariants (source parse, repository policy,
// docs integrity, stylesheet lint, the committed snapshot's manifest and draft
// guards) that should fail in seconds, before the build starts. Collect-all,
// so one report names every broken invariant, with the same one-line summaries
// publish:check prints for the same audits. They run concurrently and report
// in registry order.
import { auditsFor } from '../tests/audits/registry.ts';
import { cli } from './lib/args.ts';
import { runAudits } from './lib/audits.ts';
import { status } from './lib/run.ts';
import { annotate, createReport, endGroup, group, inActions } from './lib/step-summary.ts';

cli({ usage: 'usage: node bin/gate-check.ts' });
const report = createReport('Gate', 'Audit');

await runAudits(auditsFor('gate'), {
  onResult(result, audit) {
    group(`${audit.label.padEnd(12)} ${audit.name}`);
    // Full output lives inside the collapsed group in Actions; locally the
    // one-line status is the whole story unless the audit failed.
    if (inActions && result.output.trim()) console.log(result.output.trimEnd());
    endGroup();

    report.add(audit.label, result.ok, result.detail);
    if (result.ok !== false) {
      status(audit.label, result.detail);
      return;
    }
    status(audit.label, `FAILED: ${result.detail}`);
    annotate('error', `gate: ${audit.label}`, `${result.detail}. ${audit.fix}`);
    if (!inActions && result.output.trim()) console.error(result.output.trimEnd());
  },
});

const failed = report.failed();
report.write(failed.length === 0
  ? `All ${report.rows.length} pre-build audits passed.`
  : `${failed.length} of ${report.rows.length} pre-build audits failed.`);

if (failed.length > 0) {
  console.error(`\nfailed: ${failed.map((row) => row.label).join(', ')}`);
  process.exit(1);
}

console.log(`\nok gate: ${report.rows.length} pre-build audits passed`);
