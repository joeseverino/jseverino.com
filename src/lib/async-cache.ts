export function asyncCache<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    // Promise.try turns a load that throws before it returns into a rejection too.
    pending ??= Promise.try(load).catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
