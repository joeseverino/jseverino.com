// Engine shared by the desired-state tools (bin/cloudflare.ts, bin/github.ts): diff item shapes and the
// check / plan / apply flow. A tool supplies the live read, the diff, and the executor.
import { isDeepStrictEqual } from 'node:util';
import { errorMessage } from '../../src/lib/error-message.ts';
import { readJson } from '../../src/lib/json.ts';
import { parse } from './args.ts';
import { assertMatches, type JsonSchema } from './json-schema.ts';

// The options every tool's main() takes, for tests: arguments, environment, and
// where output goes.
export interface ToolOptions {
  argv?: string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  write?: ((line: string) => void) | undefined;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// A call to make, or a `use` step that binds an existing id and makes none.
export interface Call {
  method: Method;
  path: string;
  body?: unknown;
  saveAs?: Record<string, string>;
}

export type Step = Call | { use: Record<string, string> };

// ok | drift (apply fixes it) | manual (a person must) | unavailable (the API
// does not expose it here; reported, not counted).
export type ItemStatus = 'ok' | 'drift' | 'manual' | 'unavailable';

export interface Item {
  area: string;
  name: string;
  want: string;
  have: string;
  status: ItemStatus;
  steps: Step[];
  note: string;
}

export function loadDesired<T>(file: string, schemaFile: string): T {
  const desired: unknown = readJson(file);
  const schema: JsonSchema = readJson(schemaFile);
  assertMatches<T>(schema, desired, file);
  return desired;
}

// Key order never counts: APIs return fields in an order of their own.
export const same: (a: unknown, b: unknown) => boolean = isDeepStrictEqual;
const show = (value: unknown): string => (value === undefined || value === null ? 'absent' : typeof value === 'string' ? value : JSON.stringify(value));

export function item(area: string, name: string, want: unknown, have: unknown, status: ItemStatus, steps: Step[] = [], note = ''): Item {
  return { area, name, want: show(want), have: show(have), status, steps, note };
}

export const changedKeys = (want: Record<string, unknown>, have: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(want), ...Object.keys(have)])].filter((key) => !same(want[key], have[key]));

// A JSON value's own fields; anything but an object has none.
export const fields = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

export const pick = (object: unknown, keys: readonly string[]): Record<string, unknown> => {
  const source = fields(object);
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
};

const drifted = (items: Item[]): Item[] => items.filter((entry) => entry.status === 'drift' || entry.status === 'manual');

const isCall = (step: Step): step is Call => 'method' in step;

const plannedCalls = (items: Item[]): Call[] => items.filter((entry) => entry.status === 'drift').flatMap((entry) => entry.steps.filter(isCall));

// Makes the drifted items' calls in order, logging each as `METHOD path`. `use` steps bind an existing id
// and make no call.
export async function applySteps(
  items: Item[],
  { call, use = () => {}, log }: { call: (step: Call) => Promise<void>; use?: (ids: Record<string, string>) => void; log: (line: string) => void },
): Promise<void> {
  for (const entry of items.filter((candidate) => candidate.status === 'drift')) {
    for (const step of entry.steps) {
      if (!isCall(step)) {
        use(step.use);
        continue;
      }
      await call(step);
      log(`${step.method} ${step.path}`);
    }
  }
}

function render(items: Item[], write: (line: string) => void): void {
  const rows = items.map((entry) => [entry.status, entry.area, entry.name, entry.want, entry.have, entry.note]);
  const headers = ['status', 'area', 'item', 'want', 'have', 'note'];
  const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => clip(row[column] ?? '').length)));
  const line = (row: string[]) =>
    row
      .map((value, column) => clip(value).padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  write(line(headers));
  for (const row of rows) write(line(row));
}

const describeCall = (step: Call): string => `${step.method} ${step.path}${step.body === undefined ? '' : ` ${JSON.stringify(step.body).slice(0, 200)}`}`;

const COMMANDS = ['check', 'plan', 'apply'] as const;

// What a tool hands the command flow once its desired state is loaded.
export interface Run {
  // The zone, repository, ... the desired state is about.
  target: string;
  // The desired-state file, for the summary line.
  source: string;
  survey: () => Promise<Item[]>;
  apply: (items: Item[], log: (line: string) => void) => Promise<void>;
}

interface RunToolOptions extends ToolOptions {
  usage: string;
  // The command line that runs the tool, for the hint after a drift.
  commandLine: string;
  // Called after the arguments are valid, so a bad invocation never loads
  // desired state or reads a token.
  setup: () => Run;
}

type Command = (typeof COMMANDS)[number];
interface Invocation {
  command: Command;
  json: boolean;
  yes: boolean;
}

// What argv asks for: the command and flags, or, once usage is written, the exit code
// (0 for --help, 2 for a bad invocation).
type ParsedArgv = { invocation: Invocation } | { exitCode: 0 | 2 };

function parseArgv(argv: string[], usage: string, write: (line: string) => void): ParsedArgv {
  let parsed;
  try {
    parsed = parse({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, yes: { type: 'boolean' } } });
  } catch (error) {
    write(`${errorMessage(error)}\n\n${usage}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  if (values.help) {
    write(usage);
    return { exitCode: 0 };
  }
  const command = COMMANDS.find((name) => name === positionals[0]);
  if (!command || positionals.length > 1) {
    write(usage);
    return { exitCode: 2 };
  }
  return { invocation: { command, json: Boolean(values.json), yes: Boolean(values.yes) } };
}

function check({ target, source }: Run, items: Item[], json: boolean, commandLine: string, write: (line: string) => void): number {
  const drift = drifted(items);
  if (json) write(JSON.stringify({ target, drift: drift.length, items: items.map(({ steps, ...rest }) => rest) }, null, 2));
  else {
    render(items, write);
    write(drift.length ? `\n${drift.length} item(s) drifted; \`${commandLine} plan\` shows the fix` : `\nok       ${target} matches ${source}`);
  }
  return drift.length ? 1 : 0;
}

// Lists the calls an apply would make and the items a person must fix; plan stops there,
// apply with --yes makes the calls and surveys again.
async function planOrApply(run: Run, items: Item[], { command, json, yes }: Invocation, write: (line: string) => void): Promise<number> {
  const calls = plannedCalls(items);
  const manual = items.filter((entry) => entry.status === 'manual');
  if (json && command === 'plan') {
    write(JSON.stringify({ target: run.target, calls: calls.map(({ method, path, body }) => ({ method, path, body })), manual }, null, 2));
    return 0;
  }
  write(calls.length ? `${calls.length} call(s):` : 'no API calls needed');
  for (const step of calls) write(`  ${describeCall(step)}`);
  for (const entry of manual) write(`manual: ${entry.area} ${entry.name}: ${entry.note}`);
  if (command === 'plan' || calls.length === 0) return command === 'apply' && manual.length ? 1 : 0;
  if (!yes) {
    write('\nnothing changed; re-run with --yes to make these calls');
    return 0;
  }

  await run.apply(items, (call) => write(`done     ${call}`));
  const after = drifted(await run.survey());
  for (const entry of after) write(`still    ${entry.area} ${entry.name}: ${entry.note || `${entry.have} → ${entry.want}`}`);
  return after.length ? 1 : 0;
}

async function runTool({ usage, commandLine, argv = process.argv.slice(2), write = console.log, setup }: RunToolOptions): Promise<number> {
  const parsed = parseArgv(argv, usage, write);
  if ('exitCode' in parsed) return parsed.exitCode;
  const { invocation } = parsed;
  const run = setup();
  const items = await run.survey();
  return invocation.command === 'check' ? check(run, items, invocation.json, commandLine, write) : planOrApply(run, items, invocation, write);
}

// A tool's main(): the command flow over the Run its setup builds from the
// options. Tests pass the environment, fetch, and output through the options.
export const toolMain =
  <O extends ToolOptions>({ usage, commandLine, setup }: { usage: string; commandLine: string; setup: (options: O) => Run }) =>
  (options: O): Promise<number> =>
    runTool({ ...options, usage, commandLine, setup: () => setup(options) });
