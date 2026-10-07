#!/usr/bin/env node
// The Cloudflare zone and account posture in cloudflare/zone.json, checked
// against the live API and applied on request. See docs/Cloudflare.md.
//
//   node bin/cloudflare.ts check [--json]    # read-only; exit 1 on drift
//   node bin/cloudflare.ts plan [--json]     # the calls an apply would make
//   node bin/cloudflare.ts apply [--yes]     # plan, or with --yes, execute
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, createRun, loadDesired, type ClientOptions } from './lib/cloudflare.ts';
import { exitWith, toolMain, type ToolOptions } from './lib/drift.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { edgeRuntime } from '../tests/browser-test-env.ts';

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
    Zone     Zone, Zone Settings, DNS, Zone WAF, API Gateway,
             Bot Management                                         Read
    Account  Account Rulesets, Account Filter Lists, Cloudflare Pages,
             Access: Apps and Policies, Turnstile                   Read
  apply (edit):
    Zone     Zone                                                   Read
    Zone     Zone Settings, DNS, Zone WAF, API Gateway,
             Bot Management                                         Edit
    Account  Account Rulesets, Account Filter Lists, Cloudflare Pages,
             Turnstile                                              Edit
    Account  Access: Apps and Policies                              Read`;

const desiredFile = fromRoot('cloudflare/zone.json');
const schemaFile = fromRoot('cloudflare/zone.schema.json');

export interface MainOptions extends ToolOptions, Pick<ClientOptions, 'fetch' | 'wait'> {}

export const main = toolMain<MainOptions>({
  usage: USAGE,
  command: 'node bin/cloudflare.ts',
  setup({ env = process.env, fetch = globalThis.fetch, wait = (ms: number) => sleep(ms) }) {
    const desired = loadDesired(desiredFile, schemaFile);
    return createRun(desired, createClient({ token: env.CLOUDFLARE_API_TOKEN, fetch, wait }), {
      openapi: fs.readFileSync(fromRoot(desired.schemaValidation.file), 'utf8'),
      compatibilityDate: edgeRuntime.compatibilityDate,
    });
  },
});

if (import.meta.main) await exitWith('cloudflare', () => main({}));
