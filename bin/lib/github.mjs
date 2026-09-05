// The gh CLI as functions, for scripts that run where gh is already
// authenticated: locally, and in Actions through GH_TOKEN.
import { spawnSync } from 'node:child_process';

export function ghApi(pathname, params = {}) {
  const args = ['api', pathname, '--method', 'GET'];
  for (const [key, value] of Object.entries(params)) args.push('-f', `${key}=${value}`);
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh api ${pathname} failed`);
  return JSON.parse(result.stdout);
}

export const checkRuns = (repository, sha) =>
  ghApi(`repos/${repository}/commits/${sha}/check-runs`, { per_page: 100 }).check_runs;

export const openCodeScanningAlerts = (repository) =>
  ghApi(`repos/${repository}/code-scanning/alerts`, { state: 'open', per_page: 100 });
