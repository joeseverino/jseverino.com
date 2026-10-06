// The message of whatever a catch block received. A throw is not always an
// Error, and `(error as Error).message` prints `undefined` for one that is not.
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
