#!/usr/bin/env node
// site: the writeup publishing workflow, vault → repo → pull request → live.
// Built for an agent caller first: every command answers --help, rejects
// unknown flags, never prompts, and with --json prints one JSON document on
// stdout ({ ok, command, status, ..., next, error? }) with progress on stderr.
// `manage` is the one interactive command and needs a terminal.
import type { parseArgs, ParseArgsOptionsConfig } from 'node:util';
import { parse, flag } from './lib/args.ts';
import { JSON_LOGS_ENV } from './lib/run.ts';
import { EXIT, SiteError, createOutput, type Output } from './site/cli.ts';
import { collectionFields } from '../src/lib/content-contract.ts';
import type { CommandName, CommandResults, SiteFailure, SiteHelp, SiteSuccessOf } from './site/types.ts';
import { errorMessage } from '../src/lib/error-message.ts';

type Values<O extends ParseArgsOptionsConfig> =
  ReturnType<typeof parseArgs<{ options: O; allowPositionals: true; strict: true }>>['values'];

interface RunContext<V> {
  values: V;
  positionals: string[];
  out: Output;
}

export interface Command<R = unknown> {
  summary: string;
  usage: string;
  help?: string;
  options?: ParseArgsOptionsConfig;
  // [min, max] positional arguments; none when absent.
  positionals?: [number, number];
  // Needs a terminal and prints no result, so --json is a usage error.
  interactive?: boolean;
  run(context: RunContext<Record<string, unknown>>): Promise<R>;
}

// main() parses each command's argv with that command's own options, so its
// run() sees exactly the values those options declare.
const define = <const O extends ParseArgsOptionsConfig, R>(
  command: Omit<Command<R>, 'options' | 'run'> & { options?: O; run(context: RunContext<Values<O>>): Promise<R> },
): Command<R> => command as Command<R>;

const authoring = () => import('./site/authoring.ts');
const local = () => import('./site/local.ts');
const writeupOps = () => import('./site/writeups.ts');
const siteOps = () => import('./site/ops.ts');

// `site set` flags: each contract field with a cli_flag, plus published.
const SET_FIELDS = Object.entries(collectionFields('writeups'))
  .filter(([, spec]) => spec.editable === true && spec.cli_flag)
  .map(([name, spec]) => [name, (spec.cli_flag as string).replace(/^--/, '')] as const);
const SET_OPTIONS = {
  ...Object.fromEntries(SET_FIELDS.map(([, flag]) => [flag, { type: 'string' as const }])),
  published: { type: 'string' as const },
  'touch-last-reviewed': flag,
} satisfies ParseArgsOptionsConfig;

function setFields(values: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, flag] of SET_FIELDS) if (typeof values[flag] === 'string') fields[name] = values[flag];
  if (values.published !== undefined) {
    if (values.published !== 'true' && values.published !== 'false') throw new SiteError('--published must be true or false', { code: EXIT.usage });
    fields.published = values.published === 'true';
  }
  return fields;
}

const minutes = (value: string, name: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SiteError(`--${name} must be a positive number of minutes`, { code: EXIT.usage });
  return n * 60_000;
};

export const COMMANDS: { [C in CommandName]: Command<CommandResults[C]> } = {
  new: define({
    summary: 'Scaffold a vault writeup from the template (starts published: false)',
    usage: 'site new <slug>',
    help: 'Creates 05 Writeups/<slug>/index.md and images/. The slug becomes /portfolio/<slug>/.',
    positionals: [1, 1],
    run: async ({ positionals: [slug], out }) => (await authoring()).newWriteup({ slug, out }),
  }),
  validate: define({
    summary: 'Check references, the frontmatter contract, and the catalog; writes nothing',
    usage: 'site validate [<slug>] [--draft]',
    help: 'Without a slug, every published writeup and page. --draft includes unpublished writeups and\ntolerates the two ship-time rules (published: true, published_at).',
    options: { draft: flag },
    positionals: [0, 1],
    run: async ({ values, positionals: [slug], out }) => (await authoring()).validate({ slug, draft: values.draft, out }),
  }),
  dev: define({
    summary: 'Run the Astro dev server; --drafts previews unpublished content',
    usage: 'site dev [--drafts] [--host <host>] [--port <port>]',
    help: 'Drafts sync into the gitignored .cache/drafts overlay the dev server reads (SITE_CONTENT_ROOT);\nthe committed snapshot is never touched, so a draft cannot be committed or deployed.',
    options: { drafts: flag, host: { type: 'string' }, port: { type: 'string' } },
    run: async ({ values, out }) => (await local()).dev({ drafts: values.drafts, host: values.host, port: values.port, out }),
  }),
  publish: define({
    summary: 'Open a pull request with the vault\'s current public content',
    usage: 'site publish [--dry-run] [--full] [--base <branch>] [--from <ref>]',
    help: [
      'Preflight, then a fresh content/<date> branch from origin/<base> in a temporary worktree (the',
      'checkout is never touched), the sync, the content diff, the fast gate plus local-only audits, a',
      'commit of exactly the files the sync declares, push, and the PR. It does not merge: site land does.',
      '',
      '  --dry-run      stop after the commit, print the summary and PR body, remove the worktree and branch',
      '  --full         run the whole publish gate (build + post-build audits) instead of the fast gate',
      '  --base         the PR\'s target branch (default main)',
      '  --from         cut the branch from this ref instead of origin/<base>',
    ].join('\n'),
    options: {
      'dry-run': flag,
      full: flag,
      base: { type: 'string', default: 'main' },
      from: { type: 'string' },
    },
    run: async ({ values, out }) => (await import('./site/publish.ts')).publish({
      dryRun: values['dry-run'], full: values.full, base: values.base, from: values.from, out,
    }),
  }),
  land: define({
    summary: 'Merge a content PR once its checks pass, wait for the deploy, verify it live',
    usage: 'site land [<pr>] [--timeout <minutes>]',
    help: [
      'Defaults to your most recent content PR. Reads the required checks from main\'s ruleset and waits',
      'until each has reported and passed on the PR head, squash-merges, waits for',
      'the merge commit\'s Cloudflare Pages deployment, verifies each published or edited writeup on',
      'production (and that removed ones return 404), then runs hq sync if the hq CLI exists.',
      'An already-merged PR skips straight to the deploy wait. --timeout bounds the whole run (default 30).',
    ].join('\n'),
    options: { timeout: { type: 'string', default: '30' } },
    positionals: [0, 1],
    run: async ({ values, positionals: [pr], out }) => (await import('./site/land.ts')).land({
      pr, timeoutMs: minutes(values.timeout, 'timeout'), out,
    }),
  }),
  verify: define({
    summary: 'Verify one writeup on production (or a deployment with --origin)',
    usage: 'site verify <slug> [--origin <url>]',
    help: 'Runs bin/deploy-verify.ts --slug: listed in the sitemap, served with headers, images resolve.',
    options: { origin: { type: 'string' } },
    positionals: [1, 1],
    run: async ({ values, positionals: [slug], out }) => (await local()).verify({ slug, origin: values.origin, out }),
  }),
  status: define({
    summary: 'Repository, dependency, vault, build, and open content PR state',
    usage: 'site status',
    run: async ({ out }) => (await local()).status({ out }),
  }),
  featured: define({
    summary: 'Show the home-page featured order, or move one writeup (renumbers 1..N)',
    usage: 'site featured [<slug> <slot|up|down|top|bottom|off>]',
    help: 'Rewrites the featured writeups\' frontmatter in one transaction. The new order ships on the next site publish.',
    positionals: [0, 2],
    run: async ({ positionals: [slug, target], out }) => (await authoring()).featured({ slug, target, out }),
  }),
  tech: define({
    summary: 'List technology slugs from the vault catalog, filtered by a query',
    usage: 'site tech [<query>]',
    positionals: [0, 1],
    run: async ({ positionals: [query], out }) => (await authoring()).tech({ query, out }),
  }),
  seo: define({
    summary: 'Preview a built page\'s search snippet and metadata',
    usage: 'site seo <page> [--result]',
    help: 'Page: a URL, path, page slug, or writeup slug. Reads the last build (npm run build:static).',
    options: { result: { type: 'boolean', short: 'r', default: false } },
    positionals: [1, 1],
    run: async ({ values, positionals: [page = ''], out }) => (await local()).seo({ page, result: values.result, out }),
  }),
  'draft-alt': define({
    summary: 'Draft a writeup\'s cover_alt from its cover image (Claude API)',
    usage: 'site draft-alt <slug> [--apply]',
    help: 'Needs ANTHROPIC_API_KEY. --apply writes the draft to the writeup\'s cover_alt.',
    options: { apply: flag },
    positionals: [1, 1],
    run: async ({ values, positionals: [slug], out }) => (await local()).draftAlt({ slug, apply: values.apply, out }),
  }),
  writeups: define({
    summary: 'List the vault\'s writeups with publish and featured state',
    usage: 'site writeups [--filter all|published|draft|featured]',
    help: 'featured sorts by featured_order, the order the home page renders.',
    options: { filter: { type: 'string', default: 'all' } },
    run: async ({ values, out }) => (await writeupOps()).writeups({ filter: values.filter, out }),
  }),
  dashboard: define({
    summary: 'Every writeup, the featured order, and the draft gate in one read',
    usage: 'site dashboard',
    help: 'sourceFingerprint identifies the state read; pass it as source_fingerprint in an apply-plan so a stale plan is refused.',
    run: async ({ out }) => (await writeupOps()).showDashboard({ out }),
  }),
  tag: define({
    summary: 'Which writeups use a technology slug (and how many are published)',
    usage: 'site tag <slug>',
    help: 'A tag earns a featured slot on the home page only when a published writeup uses it.',
    positionals: [1, 1],
    run: async ({ positionals: [slug = ''], out }) => (await writeupOps()).tag({ slug, out }),
  }),
  prepare: define({
    summary: 'Publish readiness for one writeup: the ship gate plus its featured slot',
    usage: 'site prepare <slug> [--tag-usage]',
    help: '--tag-usage adds how many writeups use each of its technologies.',
    options: { 'tag-usage': flag },
    positionals: [1, 1],
    run: async ({ values, positionals: [slug = ''], out }) => (await writeupOps()).prepareWriteup({ slug, tagUsage: values['tag-usage'], out }),
  }),
  'apply-plan': define({
    summary: 'Apply field updates and the complete featured order in one transaction',
    usage: 'site apply-plan [--file <plan.json>]',
    help: [
      'Reads the plan from --file or stdin:',
      '  { "updates": [{ "slug": "...", "<field>": value }], "featured_order": ["slug", ...], "source_fingerprint": "..." }',
      'Fields are the contract\'s editable ones (site contract). Every file is staged first; any failure rolls back.',
    ].join('\n'),
    options: { file: { type: 'string' } },
    run: async ({ values, out }) => (await writeupOps()).applyWriteupPlan({ file: values.file, out }),
  }),
  set: define({
    summary: 'Set editable frontmatter fields on one writeup',
    usage: `site set <slug> ${SET_FIELDS.map(([, flag]) => `[--${flag} <value>]`).join(' ')} [--published true|false] [--touch-last-reviewed]`,
    help: 'Rewrites only the changed lines; every other byte of the file is kept. Featured order is site featured.',
    options: SET_OPTIONS,
    positionals: [1, 1],
    run: async ({ values, positionals: [slug = ''], out }) => (await writeupOps()).set({
      slug, fields: setFields(values), touchLastReviewed: values['touch-last-reviewed'], out,
    }),
  }),
  link: define({
    summary: 'Replace one exact Markdown link in a writeup body',
    usage: 'site link <slug> --label <text> --from <url> --to <url>',
    help: 'Exactly one [label](from) must match; both URLs must be absolute http(s).',
    options: { label: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
    positionals: [1, 1],
    run: async ({ positionals: [slug = ''], values: { label, from, to }, out }) => (await writeupOps()).link({ slug, label, from, to, out }),
  }),
  contract: define({
    summary: 'The writeup field contract and its fingerprint',
    usage: 'site contract',
    help: 'contracts/content.v1.json: the fields an editor or client may read and write.',
    run: async ({ out }) => (await writeupOps()).contract({ out }),
  }),
  render: define({
    summary: 'One writeup body rendered exactly as the build renders it',
    usage: 'site render <slug|-> [--document]',
    help: 'Reads 05 Writeups/<slug>/index.md from the vault, or markdown on stdin with -. html is the body the build ships. --document adds document: a self-contained page with the site article layout and styles inlined, for previews (the Obsidian plugin, HQ). Asset paths stay vault-relative.',
    positionals: [1, 1],
    options: { document: flag },
    run: async ({ positionals: [slug = ''], values: { document }, out }) => (await import('./site/render.ts')).render({ slug, document, out }),
  }),
  contact: define({
    summary: 'Recent contact form submissions from D1 (redacted unless --pii)',
    usage: 'site contact [--limit <n>] [--pii]',
    help: 'Needs CLOUDFLARE_API_TOKEN (op run). --pii returns full names, emails, and messages and is written to the audit log.',
    options: { limit: { type: 'string' }, pii: flag },
    run: async ({ values, out }) => (await siteOps()).contact({ limit: values.limit, pii: values.pii, out }),
  }),
  csp: define({
    summary: 'CSP violation reports from D1: recent rows, or counts by directive',
    usage: 'site csp [--count] [--limit <n>] [--directive <name>] [--pii]',
    help: 'Needs CLOUDFLARE_API_TOKEN (op run). --pii adds ip_address, user_agent, and raw_report and is written to the audit log.',
    options: {
      count: flag,
      limit: { type: 'string' },
      directive: { type: 'string' },
      pii: flag,
    },
    run: async ({ values, out }) => (await siteOps()).csp({ count: values.count, limit: values.limit, directive: values.directive, pii: values.pii, out }),
  }),
  'd1-apply': define({
    summary: 'Apply cloudflare/d1.sql to the remote D1 database (needs --confirm)',
    usage: 'site d1-apply --confirm',
    help: 'The schema is CREATE ... IF NOT EXISTS, so it only adds. Needs CLOUDFLARE_API_TOKEN (op run).',
    options: { confirm: flag },
    run: async ({ values, out }) => (await siteOps()).d1Apply({ confirm: values.confirm, out }),
  }),
  headers: define({
    summary: 'Check the live security headers on one path',
    usage: 'site headers [<path>]',
    help: 'HEAD against the production origin (SITE_ORIGIN overrides), redirects not followed.',
    positionals: [0, 1],
    run: async ({ positionals: [pathname], out }) => (await siteOps()).headers({ path: pathname, out }),
  }),
  manage: define({
    summary: 'Interactive writeup manager: featured order, publish state, gate issues (needs a terminal)',
    usage: 'site manage',
    help: 'Every writeup on one screen. Nothing is written until you save. The one interactive command:\nit refuses to start without a TTY, and --json is a usage error.',
    interactive: true,
    run: async () => (await import('./site/manage.ts')).manage(),
  }),
};

const EXIT_HELP = 'exit codes: 0 ok, 1 failed, 2 usage, 3 preflight (the environment is not ready), 4 timed out';

function mainHelp(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length)) + 2;
  return [
    'usage: site <command> [options] [--json]',
    '',
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}${command.summary}`),
    '',
    'Every command answers --help. --json prints one JSON document on stdout:',
    '{ ok, command, status, ..., next, error?: { message, code, fix } }; progress goes to stderr.',
    EXIT_HELP,
  ].join('\n');
}

const commandHelp = (command: Command): string =>
  [`usage: ${command.usage} [--json]`, '', command.summary, ...(command.help ? ['', command.help] : []), '', EXIT_HELP].join('\n');

const helpOptions = (command: Command): SiteHelp['options'] =>
  Object.entries({ json: flag, ...command.options })
    .map(([name, option]) => ({ name, type: option.type, ...('default' in option ? { default: option.default } : {}) }));

function helpDocument(name: CommandName | undefined): SiteHelp {
  const tail = { exitCodes: EXIT, next: null };
  if (name) {
    const command: Command = COMMANDS[name];
    return {
      ok: true, command: name, status: 'help', usage: command.usage, summary: command.summary, help: command.help ?? null,
      options: helpOptions(command), positionals: command.positionals ?? [0, 0], ...tail,
    };
  }
  return {
    ok: true, command: 'help', status: 'help', usage: 'site <command> [options] [--json]', summary: 'The writeup publishing workflow',
    help: null, options: [{ name: 'json', type: 'boolean', default: false }], positionals: [0, 1],
    commands: Object.entries(COMMANDS).map(([command, spec]) => ({
      name: command as CommandName, summary: spec.summary, usage: spec.usage, interactive: spec.interactive === true,
    })),
    ...tail,
  };
}

function emit<C extends CommandName>(json: boolean, document: SiteSuccessOf<C> | SiteHelp | SiteFailure): void {
  if (json) console.log(JSON.stringify(document, null, 2));
}

function printHelp(json: boolean, name: CommandName | undefined): number {
  if (json) emit(true, helpDocument(name));
  else console.log(name ? commandHelp(COMMANDS[name]) : mainHelp());
  return EXIT.ok;
}

const isCommand = (name: string | undefined): name is CommandName => name !== undefined && Object.hasOwn(COMMANDS, name);

// The command's fields under the envelope; generic over the command so the
// document's type follows from its name.
async function runCommand<C extends CommandName>(name: C, rest: string[], json: boolean, out: Output): Promise<number> {
  const command = COMMANDS[name];
  let parsed;
  try {
    parsed = parse({
      args: rest,
      options: { json: flag, ...command.options },
      allowPositionals: true,
    });
  } catch (error) {
    throw new SiteError(errorMessage(error), { code: EXIT.usage, fix: `site ${name} --help` });
  }
  if (parsed.values.help) return printHelp(json, name);
  if (json && command.interactive) {
    throw new SiteError(`site ${name} is interactive and prints no JSON document`, {
      code: EXIT.usage,
      fix: 'non-interactive callers use site featured, site validate, and site status (each with --json)',
    });
  }
  const [min, max] = command.positionals ?? [0, 0];
  if (parsed.positionals.length < min || parsed.positionals.length > max) {
    throw new SiteError(`usage: ${command.usage}`, { code: EXIT.usage, fix: `site ${name} --help` });
  }
  const result = await command.run({ values: parsed.values, positionals: parsed.positionals, out });
  const status = typeof result === 'object' && result !== null && 'status' in result && typeof result.status === 'string' ? result.status : 'ok';
  emit<C>(json, { ok: true, command: name, status, ...result });
  return EXIT.ok;
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const json = rest.includes('--json') || name === '--json';
  if (!name || name === '--help' || name === '-h' || name === 'help' || name === '--json') {
    const topic = rest.find((arg) => !arg.startsWith('-'));
    return printHelp(json, isCommand(topic) ? topic : undefined);
  }
  const out = createOutput({ json });
  // Every process this command starts logs machine-readable too (bin/lib/run.ts).
  if (json) process.env[JSON_LOGS_ENV] = '1';
  try {
    if (!isCommand(name)) throw new SiteError(`unknown command: ${name}`, { code: EXIT.usage, fix: 'site --help' });
    return await runCommand(name, rest, json, out);
  } catch (error) {
    const known = error instanceof SiteError;
    const code = known ? error.code : EXIT.failed;
    const message = known ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
    if (json) {
      emit(true, {
        ok: false, command: name, status: 'failed', ...(known ? error.result : {}),
        error: { message, code, fix: known ? error.fix ?? null : null },
      });
    } else {
      console.error(`failed: ${message}`);
      if (known && error.fix) console.error(`fix: ${error.fix}`);
    }
    return code;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

export { main };
