// The one argv parser for bin/ scripts: util.parseArgs in strict mode, so an
// unknown or mistyped flag stops the script instead of being silently ignored.
// Every script also answers --help with its usage.
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
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
export function parse<const O extends ParseArgsOptionsConfig = {}, const P extends boolean = false>(
  { options, allowPositionals, args = process.argv.slice(2) }: ParseConfig<O, P> = {},
) {
  return parseArgs({
    args,
    options: { ...help, ...options } as typeof help & O,
    allowPositionals: (allowPositionals ?? false) as P,
    strict: true,
  });
}

// parse() for an entry point: usage on --help, usage and exit 2 on bad input.
export function cli<const O extends ParseArgsOptionsConfig = {}, const P extends boolean = false>(
  { usage, ...config }: ParseConfig<O, P> & { usage?: string } = {},
) {
  let parsed: ReturnType<typeof parse<O, P>>;
  try {
    parsed = parse(config);
  } catch (error) {
    console.error(`${errorMessage(error)}${usage ? `\n\n${usage}` : ''}`);
    process.exit(2);
  }
  if ((parsed.values as { help?: boolean }).help) {
    console.log(usage ?? 'This command takes no options.');
    process.exit(0);
  }
  return parsed;
}

// The write-or-verify scripts take one flag.
export const checkMode = (usage: string): boolean =>
  cli({ usage, options: { check: { type: 'boolean' } } }).values.check ?? false;
