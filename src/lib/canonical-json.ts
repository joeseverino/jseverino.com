// JSON with object keys sorted at every depth, so equal data always serializes identically.
import crypto from 'node:crypto';

export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export const jsonFingerprint = (value: unknown): string => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
