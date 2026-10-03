// Minimal D1 stand-in for the Cloudflare Pages function tests: records every
// executed query with its bound values and returns scripted results.

export interface RecordedQuery {
  query: string;
  values: unknown[];
}

export interface D1StubOptions {
  firstResult?: unknown;
  failRun?: boolean;
  failFirst?: boolean;
  /** Rows a run() reports changed; 0 simulates a conditional INSERT that wrote nothing. */
  changes?: number;
}

export function createD1Stub(options: D1StubOptions = {}) {
  const queries: RecordedQuery[] = [];
  const result = () => ({ success: true, meta: { changes: options.changes ?? 1 } });
  // D1 statements are immutable: bind() returns a new statement.
  const statement = (query: string, values: unknown[] = []) => ({
    record: { query, values } as RecordedQuery,
    bind(...bound: unknown[]) {
      return statement(query, bound);
    },
    async first() {
      queries.push(this.record);
      if (options.failFirst) throw new Error('d1 unavailable');
      return options.firstResult ?? null;
    },
    async run() {
      queries.push(this.record);
      if (options.failRun) throw new Error('d1 unavailable');
      return result();
    },
  });
  return {
    queries,
    prepare: (query: string) => statement(query),
    async batch(statements: ReturnType<typeof statement>[]) {
      queries.push(...statements.map((entry) => entry.record));
      if (options.failRun) throw new Error('d1 unavailable');
      return statements.map(result);
    },
  };
}
