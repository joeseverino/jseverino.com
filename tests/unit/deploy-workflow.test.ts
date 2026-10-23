import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { readJson } from '../../src/lib/json.ts';
import { DEPLOY_CHECK } from '../../src/lib/site-config.ts';
import { fromRoot } from '../../src/lib/site-root.ts';

// The app GitHub's Actions token creates check-runs as (`gh api /apps/github-actions --jq .id`).
const GITHUB_ACTIONS_APP = 15368;

interface Step {
  id?: string;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
}

const yaml = <T>(file: string): T => load(fs.readFileSync(fromRoot(file), 'utf8')) as T;

test('the deploy check-run the workflow writes is the one main requires, from the Actions app', () => {
  const action = yaml<{ runs: { steps: Step[] } }>('.github/actions/deploy-check/action.yml');
  const open = action.runs.steps.find((step) => step.id === 'open');
  assert.equal(open?.env?.NAME, DEPLOY_CHECK);

  const repo = readJson<{ ruleset: { rules: { type: string; parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }[] } }>(
    fromRoot('.github/repo.json'),
  );
  const required = repo.ruleset.rules.flatMap((rule) => rule.parameters?.required_status_checks ?? []);
  assert.deepEqual(
    required.find((check) => check.context === DEPLOY_CHECK),
    { context: DEPLOY_CHECK, integration_id: GITHUB_ACTIONS_APP },
  );
});

// The report job runs bin/pr-comment.ts beside a pull-requests: write token, so it checks out the
// default branch's code (no ref), never the pull request's.
test("the PR comment runs from the default branch's checkout", () => {
  const { jobs } = yaml<{ jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }> }>('.github/workflows/deploy.yml');
  const steps = jobs.report?.steps ?? [];
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.ok(checkout, 'the report job checks out');
  assert.equal(checkout.with?.ref, undefined);
  assert.ok(steps.some((step) => step.run?.includes('bin/pr-comment.ts')));
});

// A workflow_run job's own check-run lands on the default branch's commit, which is often the
// deployed one, so a job sharing the name would satisfy the wait before anything deployed.
test('no workflow job is named like the deploy check', () => {
  for (const file of fs.readdirSync(fromRoot('.github/workflows'))) {
    const { jobs } = yaml<{ jobs: Record<string, Job> }>(`.github/workflows/${file}`);
    for (const [id, job] of Object.entries(jobs)) assert.notEqual(job.name ?? id, DEPLOY_CHECK, `${file}: job ${id}`);
  }
});
