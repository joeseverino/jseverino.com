#!/usr/bin/env node
// site: the writeup publishing workflow, vault → repo → pull request → live.
// Built for an agent caller first: every command answers --help, rejects
// unknown flags, never prompts, and with --json prints one JSON document on
// stdout ({ ok, command, status, ..., next, error? }) with progress on stderr.
// `manage` is the one interactive command and needs a terminal.
import type { parseArgs, ParseArgsOptionsConfig } from 'node:util';
import { parse } from './lib/args.ts';
import { JSON_LOGS_ENV } from './lib/run.ts';
import { EXIT, SiteError, createOutput, type Output } from './site/cli.ts';
import type { CommandName, CommandResults, SiteFailure, SiteHelp, SiteSuccessOf } from './site/types.ts';

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
    options: { draft: { type: 'boolean', default: false } },
    positionals: [0, 1],
    run: async ({ values, positionals: [slug], out }) => (await authoring()).validate({ slug, draft: values.draft, out }),
  }),
  dev: define({
    summary: 'Run the Astro dev server; --drafts previews unpublished content',
    usage: 'site dev [--drafts] [--host <host>] [--port <port>]',
    help: 'Drafts sync into the gitignored .cache/drafts overlay the dev server reads (SITE_CONTENT_ROOT);\nthe committed snapshot is never touched, so a draft cannot be committed or deployed.',
    options: { drafts: { type: 'boolean', default: false }, host: { type: 'string' }, port: { type: 'string' } },
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
      'dry-run': { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
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
    help: 'Writes vault frontmatter through severino-vault-mcp. The new order ships on the next site publish.',
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
    help: 'Needs ANTHROPIC_API_KEY. --apply writes the draft to the vault through severino-vault-mcp.',
    options: { apply: { type: 'boolean', default: false } },
    positionals: [1, 1],
    run: async ({ values, positionals: [slug], out }) => (await local()).draftAlt({ slug, apply: values.apply, out }),
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
  Object.entries({ json: { type: 'boolean' as const, default: false }, ...command.options })
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
      options: { json: { type: 'boolean', default: false }, ...command.options },
      allowPositionals: true,
    });
  } catch (error) {
    throw new SiteError((error as Error).message, { code: EXIT.usage, fix: `site ${name} --help` });
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
