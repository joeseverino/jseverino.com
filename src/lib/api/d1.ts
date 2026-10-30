// The part of the D1 binding the endpoints call. The handlers also run under Node in the unit
// suite, which has no Workers types; tsconfig.worker.json holds the generated D1Database to it.
interface D1Result {
  meta: { changes: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
