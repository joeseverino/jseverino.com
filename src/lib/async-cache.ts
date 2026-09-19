/** Share in-flight work and successful results; allow retries after failure. */
export function asyncCache<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= Promise.resolve().then(load).catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
