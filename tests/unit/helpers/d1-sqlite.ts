// In-memory SQLite built from cloudflare/d1.sql, for real statement semantics (conditional INSERTs, batches).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { siteRoot } from '../../../src/lib/site-root.ts';

export function createD1Sqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(siteRoot, 'cloudflare/d1.sql'), 'utf8'));
  const run = (query: string, values: unknown[]) => {
    const { changes } = db.prepare(query).run(...(values as (string | number | null)[]));
    return { success: true, meta: { changes: Number(changes) } };
  };
  const statement = (query: string, values: unknown[] = []) => ({
    query,
    values,
    bind: (...bound: unknown[]) => statement(query, bound),
    async first<T>() {
      return (db.prepare(query).get(...(values as (string | number | null)[])) ?? null) as T | null;
    },
    async run() {
      return run(query, values);
    },
  });
  return {
    db,
    prepare: (query: string) => statement(query),
    async batch(statements: ReturnType<typeof statement>[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((entry) => run(entry.query, entry.values));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    count: (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n),
  };
}
