// Run fn over items with at most `limit` in flight; results keep the items' order.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  // One shared iterator: each worker takes the next item as it finishes one.
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await fn(item, index);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
