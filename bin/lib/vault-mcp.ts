// severino-vault-mcp's CLI, the vault's format-preserving writeup writer,
// always pinned to this vault so it never falls back to the MCP's own default.
// SVMC_BIN overrides the binary (the TUI tests stub it).
import { vaultRoot } from './local-paths.ts';
import { spawnResult, type SpawnResult } from './run.ts';

export const vaultMcp = (args: readonly string[], { input }: { input?: string | undefined } = {}): SpawnResult =>
  spawnResult(process.env.SVMC_BIN || 'severino-vault-mcp', args, { env: { SVMC_VAULT_PATH: vaultRoot() }, input });
