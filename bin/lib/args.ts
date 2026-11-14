// The argv parser for bin/ scripts: util.parseArgs in strict mode, so an unknown flag stops the script. Every script answers --help.
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';
import { errorMessage } from '../../src/lib/error-message.ts';

const help = { help: { type: 'boolean', short: 'h' } } as const;

// A boolean option that is off unless passed, the shape nearly every script flag takes.
export const flag = { type: 'boolean', default: false } as const;

export interface ParseConfig<O extends ParseArgsOptionsConfig, P extends boolean> {
  options?: O;
  allowPositionals?: P;
  args?: string[];
}

// Throws on an unknown flag, a missing option value, or an unexpected positional.
export function parse<const O extends ParseArgsOptionsConfig = Record<never, never>, const P extends boolean = false>({
  options,
  allowPositionals,
  args = process.argv.slice(2),
}: ParseConfig<O, P> = {}) {
  return parseArgs({
    args,
    options: { ...help, ...options } as typeof help & O,
    allowPositionals: (allowPositionals ?? false) as P,
    strict: true,
  });
}

// A whole-number option value of at least min, or undefined, so each caller words the error for
// its own option and throws its own error type.
export function positiveInt(value: string, min = 1): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : undefined;
}

// Bad input to an entry point: the problem, if there is one beyond the usage, then the usage, and
// exit 2, for arguments parseArgs cannot judge (a positional count, a variable left unset).
export function usageError(usage: string | undefined, problem?: string): never {
  console.error([problem, usage].filter(Boolean).join('\n\n'));
  process.exit(2);
}

// parse() for an entry point: usage on --help, usage and exit 2 on bad input.
export function cli<const O extends ParseArgsOptionsConfig = Record<never, never>, const P extends boolean = false>({
  usage,
  ...config
}: ParseConfig<O, P> & { usage?: string } = {}) {
  let parsed: ReturnType<typeof parse<O, P>>;
  try {
    parsed = parse(config);
  } catch (error) {
    usageError(usage, errorMessage(error));
  }
  if ((parsed.values as { help?: boolean }).help) {
    console.log(usage ?? 'This command takes no options.');
    process.exit(0);
  }
  return parsed;
}

// The write-or-verify scripts take one flag.
export const checkMode = (usage: string): boolean =>
  cli({ usage: `${usage}\n\n  --check  Write nothing; fail if a committed file differs from what this derives.`, options: { check: flag } }).values.check;

// A tool's entry point: its exit code, or 2 with the error on stderr.
export async function exitWith(name: string, run: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await run();
  } catch (error) {
    console.error(`${name}: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}
