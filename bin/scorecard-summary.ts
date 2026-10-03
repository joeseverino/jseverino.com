#!/usr/bin/env node
// Turns an OpenSSF Scorecard JSON result into the job summary: the aggregate
// score and one row per check, lowest first, with Scorecard's own reason. The
// SARIF the workflow uploads to code scanning lists only the checks that
// produced findings; the JSON carries every check and the aggregate.
//
//   node bin/scorecard-summary.ts scorecard.json
import { status } from './lib/run.ts';
import { appendSummary, table } from './lib/step-summary.ts';
import { readJson } from '../src/lib/json.ts';

const file = process.argv[2] ?? 'scorecard.json';
// The fields of Scorecard's --format=json result this summary reads.
interface ScorecardResult {
  score: number;
  checks: { name: string; score: number; reason: string }[];
  scorecard?: { version?: string };
  repo?: { commit?: string };
}

const result = readJson<ScorecardResult>(file);

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
