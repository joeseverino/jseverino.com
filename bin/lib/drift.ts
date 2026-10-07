// Engine shared by the desired-state tools (bin/cloudflare.ts, bin/github.ts): diff item shapes and the
// check / plan / apply flow. A tool supplies the live read, the diff, and the executor.
import { parse } from './args.ts';
import { assertMatches, type JsonSchema } from './json-schema.ts';
import { readJson } from '../../src/lib/json.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

// What the client needs from fetch: a URL string and an init.
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

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
  awaitBulk?: boolean;
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

// Objects with their keys sorted at every depth: APIs return fields in an order of their own.
export const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
};

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
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

const plannedCalls = (items: Item[]): Call[] =>
  items.filter((entry) => entry.status === 'drift').flatMap((entry) => entry.steps.filter(isCall));

// The calls an apply makes, in order. `use` steps bind an existing id and make
// no call. Returns each call made as `METHOD path`.
export async function applySteps(
  items: Item[],
  { call, use = () => {}, log = () => {} }: { call: (step: Call) => Promise<void>; use?: (ids: Record<string, string>) => void; log?: (line: string) => void },
): Promise<string[]> {
  const made: string[] = [];
  for (const entry of items.filter((candidate) => candidate.status === 'drift')) {
    for (const step of entry.steps) {
      if (!isCall(step)) {
        use(step.use);
        continue;
      }
      await call(step);
      made.push(`${step.method} ${step.path}`);
      log(`${step.method} ${step.path}`);
    }
  }
  return made;
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

// What a tool hands the command flow once its desired state is loaded.
export interface Run {
  // The zone, repository, ... the desired state is about.
  target: string;
  // The desired-state file, for the summary line.
  source: string;
  survey: () => Promise<Item[]>;
  apply: (items: Item[], log: (line: string) => void) => Promise<unknown>;
}

interface RunToolOptions extends ToolOptions {
  usage: string;
  // How the tool is invoked, for the hint after a drift.
  command: string;
  // Called after the arguments are valid, so a bad invocation never loads
  // desired state or reads a token.
  setup: () => Run;
}

async function runTool({ usage, command: invocation, argv = process.argv.slice(2), write = console.log, setup }: RunToolOptions): Promise<number> {
  let parsed;
  try {
    parsed = parse({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, yes: { type: 'boolean' } } });
  } catch (error) {
    write(`${errorMessage(error)}\n\n${usage}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help) {
    write(usage);
    return 0;
  }
  if (!COMMANDS.some((name) => name === command) || positionals.length > 1) {
    write(usage);
    return 2;
  }

  const { target, source, survey, apply } = setup();
  const items = await survey();
  const drift = drifted(items);
  const calls = plannedCalls(items);

  if (command === 'check') {
    if (values.json) write(JSON.stringify({ target, drift: drift.length, items: items.map(({ steps, ...rest }) => rest) }, null, 2));
    else {
      render(items, write);
      write(drift.length ? `\n${drift.length} item(s) drifted; \`${invocation} plan\` shows the fix` : `\nok       ${target} matches ${source}`);
    }
    return drift.length ? 1 : 0;
  }

  const manual = items.filter((entry) => entry.status === 'manual');
  if (values.json && command === 'plan') {
    write(JSON.stringify({ target, calls: calls.map(({ method, path, body }) => ({ method, path, body })), manual }, null, 2));
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

  await apply(items, (call) => write(`done     ${call}`));
  const after = drifted(await survey());
  for (const entry of after) write(`still    ${entry.area} ${entry.name}: ${entry.note || `${entry.have} → ${entry.want}`}`);
  return after.length ? 1 : 0;
}

// A tool's main(): the command flow over the Run its setup builds from the
// options. Tests pass the environment, fetch, and output through the options.
export const toolMain = <O extends ToolOptions>({ usage, command, setup }: { usage: string; command: string; setup: (options: O) => Run }) =>
  (options: O): Promise<number> => runTool({ ...options, usage, command, setup: () => setup(options) });

// A tool's entry point: its exit code, or 2 with the error on stderr.
export async function exitWith(name: string, run: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await run();
  } catch (error) {
    console.error(`${name}: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}
