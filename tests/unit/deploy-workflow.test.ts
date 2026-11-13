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
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  'run-name'?: string;
  on: Record<string, unknown>;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

const yaml = <T>(file: string): T => load(fs.readFileSync(fromRoot(file), 'utf8')) as T;
const workflows = fs.readdirSync(fromRoot('.github/workflows')).map((file) => ({ file, workflow: yaml<Workflow>(`.github/workflows/${file}`) }));

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
  const steps = yaml<Workflow>('.github/workflows/preview.yml').jobs.report?.steps ?? [];
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.ok(checkout, 'the report job checks out');
  assert.equal(checkout.with?.ref, undefined);
  assert.ok(steps.some((step) => step.run?.includes('bin/pr-comment.ts')));
});

// A workflow_run job's own check-run lands on the default branch's commit, which is often the
// deployed one, so a job sharing the name would satisfy the wait before anything deployed.
test('no workflow job is named like the deploy check', () => {
  for (const { file, workflow } of workflows) {
    for (const [id, job] of Object.entries(workflow.jobs)) assert.notEqual(job.name ?? id, DEPLOY_CHECK, `${file}: job ${id}`);
  }
});

// Every run of a workflow ci starts is otherwise titled by the workflow's name alone.
test('a workflow ci starts is titled by the ci run it ships', () => {
  const followers = workflows.filter(({ workflow }) => 'workflow_run' in workflow.on);
  assert.ok(followers.length > 0);
  for (const { file, workflow } of followers) assert.match(workflow['run-name'] ?? '', /github\.event\.workflow_run\.display_title/, file);
});

// A package's install script would run beside the secret; package.json's allowScripts is no
// defense once a dependency is compromised.
test('a job that holds a secret runs no package install script', () => {
  for (const { file, workflow } of workflows) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (!JSON.stringify(job).includes('secrets.')) continue;
      assert.equal(job.env?.npm_config_ignore_scripts ?? workflow.env?.npm_config_ignore_scripts, 'true', `${file}: job ${id}`);
    }
  }
});

// The Cloudflare token never shares a job with a token that can sign an attestation or write
// the repository, so a compromised deploy step can neither forge provenance nor rewrite dist.
test('no job holds both a secret and a write to the repository or an attestation', () => {
  const writes = ['contents', 'id-token', 'attestations'];
  for (const { file, workflow } of workflows) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (!JSON.stringify(job).includes('secrets.')) continue;
      for (const scope of writes) assert.notEqual(job.permissions?.[scope], 'write', `${file}: job ${id} holds ${scope}: write`);
    }
  }
});
