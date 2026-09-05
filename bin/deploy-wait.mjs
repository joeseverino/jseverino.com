#!/usr/bin/env node
// Waits for Cloudflare Pages to finish building a commit. The deployment is
// triggered by the push, not by the workflow, and reports back only as a
// check-run on the commit; this gives it a node in the run graph, a summary,
// and a gate that verify can depend on.
//
//   DEPLOY_SHA=<sha> GH_TOKEN=<token> node bin/deploy-wait.mjs
import { spawnSync } from 'node:child_process';
import { SITE } from '../src/lib/site-config.mjs';
import { status } from './lib/run.mjs';
import { annotate, appendSummary, endGroup, group, table } from './lib/step-summary.mjs';

const repository = `${SITE.github}/${SITE.domain}`;
const checkName = 'Cloudflare Pages';
const sha = process.env.DEPLOY_SHA ?? process.env.GITHUB_SHA;
if (!sha) {
  console.error('failed: DEPLOY_SHA (or GITHUB_SHA) must name the commit Cloudflare is building');
  process.exit(1);
}

function checkRuns() {
  const result = spawnSync(
    'gh',
    ['api', `repos/${repository}/commits/${sha}/check-runs`, '--method', 'GET', '-f', 'per_page=100'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'gh api failed');
  return JSON.parse(result.stdout).check_runs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const started = Date.now();
const deadline = started + 15 * 60_000;
let lastReport = '';
let check = null;

group(`deploy      waiting for ${checkName} on ${sha.slice(0, 12)}`);
try {
  while (Date.now() < deadline) {
    check = checkRuns().find((run) => run.name === checkName) ?? null;
    const report = check ? `${check.status}${check.conclusion ? ` (${check.conclusion})` : ''}` : 'not yet reported';
    if (report !== lastReport) {
      lastReport = report;
      status('deploy', `${report} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    if (check?.status === 'completed') break;
    await sleep(10_000);
  }
} finally {
  endGroup();
}

// Cloudflare posts the check-run already completed, so its own timestamps say
// nothing about build time; the wait from this job's start is what is known.
const ok = check?.status === 'completed' && check.conclusion === 'success';
const environment = process.env.GITHUB_EVENT_NAME === 'pull_request' ? 'preview' : 'production';
const waited = `${Math.round((Date.now() - started) / 1000)}s`;
const detail = check
  ? `${check.conclusion ?? check.status}${check.output?.title ? `: ${check.output.title}` : ''}`
  : 'never reported within 15 minutes';

appendSummary([
  '## Cloudflare Pages',
  '',
  ok ? `The ${environment} deployment for \`${sha.slice(0, 12)}\` is live.` : `The ${environment} deployment for \`${sha.slice(0, 12)}\` did not succeed.`,
  '',
  table(
    ['Deployment', 'Result', 'Waited', 'Detail'],
    [[environment, ok ? 'pass' : '**FAIL**', waited, check?.details_url ? `${detail} ([dashboard](${check.details_url}))` : detail]],
  ),
].join('\n'));

if (!ok) {
  annotate('error', 'deploy', `${checkName}: ${detail}`);
  console.error(`\nfailed: ${checkName} ${detail}`);
  process.exit(1);
}

status('deploy', `${environment} deployment live; waited ${waited}`);
