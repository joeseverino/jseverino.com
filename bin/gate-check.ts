#!/usr/bin/env node
// First step of CI's build job: the registry audits that claim the 'gate' gate (fast
// pre-build invariants). Collect-all, run concurrently, reported in registry order.
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
