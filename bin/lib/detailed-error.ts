// An Error with structured details; script libraries subclass it so one catch can print it and emit --json.
export class DetailedError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}
