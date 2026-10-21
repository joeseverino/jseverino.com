// All-or-nothing file replacement: stage bodies beside their targets, confirm every file still holds the
// content the caller read, so a write that raced this one is refused, and swap. Any failure restores the
// files already swapped.
import crypto from 'node:crypto';
import fs from 'node:fs';
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
}

function stage(target: string, body: string, prefix: string): string {
  const staged = path.join(path.dirname(target), `.${path.basename(target)}.${prefix}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(staged, body, { mode: fs.statSync(target).mode & 0o777 });
  return staged;
}

interface Staged {
  file: string;
  before: string;
  temp: string;
  swapped: boolean;
}

export function transactionalReplace(
  replacements: ReadonlyMap<string, Replacement>,
  { rename = fs.renameSync }: TransactionOptions = {},
): TransactionResult {
  const staged: Staged[] = [];
  try {
    for (const [file, { before, after }] of [...replacements].toSorted(([a], [b]) => a.localeCompare(b))) {
      staged.push({ file, before, temp: stage(file, after, 'site'), swapped: false });
    }
    try {
      for (const { file, before } of staged) {
        if (fs.readFileSync(file, 'utf8') !== before) throw new Error(`file changed during transaction: ${file}`);
      }
      for (const entry of staged) {
        rename(entry.temp, entry.file);
        entry.swapped = true;
      }
      return { ok: true };
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const { file, before } of staged.filter(({ swapped }) => swapped).toReversed()) {
        try {
          fs.renameSync(stage(file, before, 'rollback'), file);
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
    for (const { temp, swapped } of staged) if (!swapped) fs.rmSync(temp, { force: true });
  }
}
