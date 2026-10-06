// An Error that carries structured details for whoever reports it. The script
// libraries throw subclasses of this so one catch can print the message and
// hand the details to --json output.
export class DetailedError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}
