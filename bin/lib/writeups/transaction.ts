// All-or-nothing file replacement: stage bodies beside their targets, then under a root lock confirm every
// file still holds the content the caller read and swap. Any failure restores the files already swapped.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errorMessage } from '../../../src/lib/error-message.ts';

export interface Replacement {
  before: string;
  after: string;
}

export type TransactionResult = { ok: true } | { ok: false; error: string; rolledBack: boolean };

export interface TransactionOptions {
  // Swap seam for tests that need a replace to fail part-way.
  rename?: (from: string, to: string) => void;
  lockTimeoutMs?: number;
}

const LOCK_STALE_MS = 30_000;

function stage(target: string, body: string, prefix: string): string {
  const staged = path.join(path.dirname(target), `.${path.basename(target)}.${prefix}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(staged, body, { mode: fs.statSync(target).mode & 0o777 });
  return staged;
}

function acquire(lockPath: string, timeoutMs: number): number {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) fs.rmSync(lockPath, { force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`another write holds ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

export function transactionalReplace(
  root: string,
  replacements: ReadonlyMap<string, Replacement>,
  { rename = fs.renameSync, lockTimeoutMs = 5_000 }: TransactionOptions = {},
): TransactionResult {
  if (replacements.size === 0) return { ok: true };
  const staged = new Map<string, string>();
  const replaced: string[] = [];
  const lockKey = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  const lockPath = path.join(os.tmpdir(), `site-writeups-${lockKey}.lock`);
  let lock: number | undefined;
  try {
    for (const [file, { after }] of replacements) staged.set(file, stage(file, after, 'site'));
    lock = acquire(lockPath, lockTimeoutMs);
    try {
      for (const [file, { before }] of replacements) {
        if (fs.readFileSync(file, 'utf8') !== before) throw new Error(`file changed during transaction: ${file}`);
      }
      for (const file of [...replacements.keys()].sort()) {
        rename(staged.get(file) as string, file);
        staged.delete(file);
        replaced.push(file);
      }
      return { ok: true };
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const file of replaced.reverse()) {
        try {
          fs.renameSync(stage(file, (replacements.get(file) as Replacement).before, 'rollback'), file);
        } catch (rollbackError) {
          rollbackErrors.push(`${file}: ${errorMessage(rollbackError)}`);
        }
      }
      const detail = errorMessage(error) + (rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join('; ')}` : '');
      return { ok: false, error: detail, rolledBack: rollbackErrors.length === 0 };
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error), rolledBack: true };
  } finally {
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.rmSync(lockPath, { force: true });
    }
    for (const file of staged.values()) fs.rmSync(file, { force: true });
  }
}
