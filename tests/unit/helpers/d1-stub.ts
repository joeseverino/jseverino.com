// Minimal D1 stand-in for the Cloudflare Pages function tests: records every
// executed query with its bound values and returns scripted results.

export interface RecordedQuery {
  query: string;
  values: unknown[];
}

export interface D1StubOptions {
  firstResult?: unknown;
  failRun?: boolean;
}

export function createD1Stub(options: D1StubOptions = {}) {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    prepare(query: string) {
      const record: RecordedQuery = { query, values: [] };
      const statement = {
        bind(...values: unknown[]) {
          record.values = values;
          return statement;
        },
        async first() {
          queries.push(record);
          return options.firstResult ?? null;
        },
        async run() {
          queries.push(record);
          if (options.failRun) throw new Error('d1 unavailable');
          return { success: true };
        },
      };
      return statement;
    },
  };
}
