#!/usr/bin/env node
// Turns an OpenSSF Scorecard JSON result into the job summary: the aggregate
// score and one row per check, lowest first, with Scorecard's own reason. The
// SARIF the workflow uploads to code scanning lists only the checks that
// produced findings; the JSON carries every check and the aggregate.
//
//   node bin/scorecard-summary.mjs scorecard.json
import fs from 'node:fs';
import { status } from './lib/run.mjs';
import { appendSummary, table } from './lib/step-summary.mjs';

const file = process.argv[2] ?? 'scorecard.json';
const result = JSON.parse(fs.readFileSync(file, 'utf8'));

const checks = [...result.checks].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
const scored = checks.filter((check) => check.score >= 0);
const inconclusive = checks.filter((check) => check.score < 0);

for (const check of checks) {
  status(String(check.score).padStart(3), `${check.name}: ${check.reason}`);
}

appendSummary([
  `## OpenSSF Scorecard ${result.score} / 10`,
  '',
  `${scored.filter((check) => check.score === 10).length} of ${scored.length} scored checks at 10; ${inconclusive.length} inconclusive (excluded from the aggregate). Scorecard ${result.scorecard?.version ?? ''} at \`${(result.repo?.commit ?? '').slice(0, 12)}\`.`,
  '',
  table(
    ['Score', 'Check', 'Reason'],
    checks.map((check) => [check.score < 0 ? 'n/a' : check.score, check.name, check.reason]),
  ),
].join('\n'));

console.log(`\nok scorecard ${result.score} / 10 across ${scored.length} scored checks`);
