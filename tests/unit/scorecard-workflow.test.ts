import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { fromRoot } from '../../src/lib/site-root.ts';

interface Job {
  'runs-on': unknown;
  permissions?: Record<string, string>;
  env?: unknown;
  defaults?: unknown;
  container?: unknown;
  services?: unknown;
  steps: { uses?: string; with?: Record<string, unknown> }[];
}

const workflow = load(fs.readFileSync(fromRoot('.github/workflows/scorecard.yml'), 'utf8')) as {
  env?: unknown;
  defaults?: unknown;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

// The rules the OpenSSF API checks before it accepts a published result
// (ossf/scorecard-infra api/app/server/verify_workflow.go); a run that breaks one fails.
const APPROVED = [
  'actions/checkout',
  'actions/create-github-app-token',
  'ossf/scorecard-action',
  'actions/upload-artifact',
  'github/codeql-action/upload-sarif',
  'step-security/harden-runner',
];

test('the scorecard workflow meets what the OpenSSF API requires to publish its result', () => {
  assert.equal(workflow.env, undefined, 'no workflow-level env');
  assert.equal(workflow.defaults, undefined, 'no workflow-level defaults');
  assert.ok(!Object.values(workflow.permissions ?? {}).includes('write'), 'no workflow-level write permission');

  const jobs = Object.entries(workflow.jobs);
  const publishing = jobs.filter(([, job]) => job.steps.some((step) => step.uses?.startsWith('ossf/scorecard-action@') && step.with?.publish_results === true));
  assert.equal(publishing.length, 1, 'one job publishes');
  const [[name, job]] = publishing as [[string, Job]];
  for (const [other, entry] of jobs) if (other !== name) assert.notEqual(entry.permissions?.['id-token'], 'write', `${other} holds id-token: write`);

  assert.equal(job.permissions?.['id-token'], 'write');
  for (const key of ['env', 'defaults', 'container', 'services'] as const) assert.equal(job[key], undefined, `the job sets ${key}`);
  assert.match(String(job['runs-on']), /^ubuntu-(latest|2[2-9]\.\d{2}|[3-9]\d\.\d{2})(-arm)?$/, 'one hosted Ubuntu label');
  for (const step of job.steps) {
    const action = step.uses?.split('@')[0] ?? '';
    assert.ok(APPROVED.includes(action), `${step.uses ?? 'a run step'} is not an approved action`);
  }
});
