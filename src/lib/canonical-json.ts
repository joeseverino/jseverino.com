// JSON serialized with object keys sorted at every depth, so equal data always compares and hashes identically.
import crypto from 'node:crypto';

function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

// The canonical form of JSON text, or null when the text is not JSON.
export function canonicalJsonText(text: string): string | null {
  try {
    return canonicalJson(JSON.parse(text));
  } catch {
    return null;
  }
}

export const jsonFingerprint = (value: unknown): string => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
