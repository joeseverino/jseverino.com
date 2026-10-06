#!/usr/bin/env node
// The Cloudflare zone and account posture in cloudflare/zone.json, checked
// against the live API and applied on request. See docs/Cloudflare.md.
//
//   node bin/cloudflare.ts check [--json]    # read-only; exit 1 on drift
//   node bin/cloudflare.ts plan [--json]     # the calls an apply would make
//   node bin/cloudflare.ts apply [--yes]     # plan, or with --yes, execute
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from './lib/args.ts';
import {
  apply, createClient, diff, drifted, loadDesired, plannedCalls, readLive,
  type Call, type ClientOptions, type DesiredState, type Item,
} from './lib/cloudflare.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { edgeRuntime } from '../tests/browser-test-env.ts';
import { errorMessage } from '../src/lib/error-message.ts';

export const USAGE = `usage: node bin/cloudflare.ts <check|plan|apply> [--json] [--yes]

  check   Read the live zone and account, diff against cloudflare/zone.json,
          print a table (--json for machine output). Exit 1 on drift.
  plan    The API calls an apply would make, without making them.
  apply   Prints the plan; with --yes, makes the calls, then re-checks.
          Owned rules carry a ref starting with the file's owner tag; no
          other rule is edited or deleted.

The token comes from CLOUDFLARE_API_TOKEN only (from 1Password: op run, or
the agent Environment) and is never printed. Scope it to the one zone and the
one account.

  check / plan (read):
    Zone     Zone, Zone Settings, DNS, Zone WAF, API Gateway        Read
    Account  Account Rulesets, Account Filter Lists, Cloudflare Pages,
             Access: Apps and Policies, Turnstile                   Read
  apply (edit):
    Zone     Zone                                                   Read
    Zone     Zone Settings, DNS, Zone WAF, API Gateway              Edit
    Account  Account Rulesets, Account Filter Lists, Cloudflare Pages,
             Turnstile                                              Edit
    Account  Access: Apps and Policies                              Read`;

const desiredFile = fromRoot('cloudflare/zone.json');
const schemaFile = fromRoot('cloudflare/zone.schema.json');

// Repo-side follow-ups a live zone unlocks: the scanner rule replaces the
// WordPress redirects in public/_redirects, which go once it is live.
function repoItems(desired: DesiredState, items: Item[]): Item[] {
  const rule = items.find((entry) => entry.name === `${desired.owner}-scanner-noise`);
  const redirects = fs.readFileSync(fromRoot('public/_redirects'), 'utf8');
  const stale = redirects.split('\n').filter((line) => /^\/wp-/.test(line));
  if (rule?.status !== 'ok' || stale.length === 0) return [];
  return [{
    area: 'repo', name: 'public/_redirects', want: 'no /wp-* redirects', have: `${stale.length} lines`, status: 'manual', steps: [],
    note: 'the scanner-noise rule blocks these paths at the zone now; delete the redirects',
  }];
}

function render(items: Item[], write: (line: string) => void): void {
  const rows = items.map((entry) => [entry.status, entry.area, entry.name, entry.want, entry.have, entry.note]);
  const headers = ['status', 'area', 'item', 'want', 'have', 'note'];
  const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => clip(row[column] ?? '').length)));
  const line = (row: string[]) => row.map((value, column) => clip(value).padEnd(widths[column] ?? 0)).join('  ').trimEnd();
  write(line(headers));
  for (const row of rows) write(line(row));
}

const describeCall = (step: Call): string => `${step.method} ${step.path}${step.body === undefined ? '' : ` ${JSON.stringify(step.body).slice(0, 200)}`}`;

const COMMANDS = ['check', 'plan', 'apply'] as const;

export interface MainOptions extends Pick<ClientOptions, 'fetch' | 'wait'> {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  write?: (line: string) => void;
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetch = globalThis.fetch, wait = (ms) => sleep(ms), write = console.log }: MainOptions = {}): Promise<number> {
  let parsed;
  try {
    parsed = parse({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, yes: { type: 'boolean' } } });
  } catch (error) {
    write(`${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help) {
    write(USAGE);
    return 0;
  }
  if (!COMMANDS.some((name) => name === command) || positionals.length > 1) {
    write(USAGE);
    return 2;
  }

  const desired = loadDesired(desiredFile, schemaFile);
  const context = {
    openapi: fs.readFileSync(fromRoot(desired.schemaValidation.file), 'utf8'),
    compatibilityDate: edgeRuntime.compatibilityDate,
  };
  const client = createClient({ token: env.CLOUDFLARE_API_TOKEN, fetch, wait });
  const survey = async () => {
    const items = diff(desired, await readLive(client, desired), context);
    return [...items, ...repoItems(desired, items)];
  };

  const items = await survey();
  const drift = drifted(items);
  const calls = plannedCalls(items);

  if (command === 'check') {
    if (values.json) write(JSON.stringify({ zone: desired.zone, drift: drift.length, items: items.map(({ steps, ...rest }) => rest) }, null, 2));
    else {
      render(items, write);
      write(drift.length ? `\n${drift.length} item(s) drifted; \`node bin/cloudflare.ts plan\` shows the fix` : `\nok       ${desired.zone} matches cloudflare/zone.json`);
    }
    return drift.length ? 1 : 0;
  }

  const manual = items.filter((entry) => entry.status === 'manual');
  if (values.json && command === 'plan') {
    write(JSON.stringify({ zone: desired.zone, calls: calls.map(({ method, path, body }) => ({ method, path, body })), manual }, null, 2));
    return 0;
  }
  write(calls.length ? `${calls.length} call(s):` : 'no API calls needed');
  for (const step of calls) write(`  ${describeCall(step)}`);
  for (const entry of manual) write(`manual: ${entry.area} ${entry.name}: ${entry.note}`);
  if (command === 'plan' || calls.length === 0) return command === 'apply' && manual.length ? 1 : 0;
  if (!values.yes) {
    write('\nnothing changed; re-run with --yes to make these calls');
    return 0;
  }

  await apply(client, items, { log: (call) => write(`done     ${call}`) });
  const after = drifted(await survey());
  for (const entry of after) write(`still    ${entry.area} ${entry.name}: ${entry.note || `${entry.have} → ${entry.want}`}`);
  return after.length ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`cloudflare: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}
