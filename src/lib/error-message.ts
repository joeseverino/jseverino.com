// A throw is not always an Error; `(error as Error).message` prints `undefined` for one that is not.
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
