import crypto from 'node:crypto';
import { readJson } from './json.ts';

// `image` is a path relative to the document, resolved by Astro's image pipeline.
export type FieldType = 'string' | 'boolean' | 'integer' | 'date' | 'string[]' | 'image';

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
  public?: boolean;
  editable?: boolean;
  default?: unknown;
  ownership?: string;
  cli_flag?: string;
}

export interface ContentContract {
  contract: string;
  version: number;
  collections: Record<string, { fields: Record<string, FieldSpec> }>;
}

const contractUrl = new URL('../../contracts/content.v1.json', import.meta.url);

export const contentContract: ContentContract = readJson(contractUrl);

export function collectionFields(name: string): Record<string, FieldSpec> {
  const fields = contentContract.collections[name]?.fields;
  if (!fields || typeof fields !== 'object') {
    throw new Error(`Unknown content contract collection: ${name}`);
  }
  return fields;
}

export function projectFrontmatter(name: string, data: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(collectionFields(name))) {
    if (spec.public !== true) continue;
    const value = data[field];
    if (value !== undefined && value !== null && value !== '') {
      projected[field] = value;
    } else if ('default' in spec) {
      projected[field] = structuredClone(spec.default);
    }
  }
  return projected;
}

export function canonicalContractJson(contract: unknown = contentContract): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sort(item)]));
    }
    return value;
  };
  return JSON.stringify(sort(contract));
}

export function contentContractFingerprint(contract: unknown = contentContract): string {
  return crypto.createHash('sha256').update(canonicalContractJson(contract)).digest('hex');
}

const isDate = (value: unknown): boolean =>
  (value instanceof Date && !Number.isNaN(value.getTime())) ||
  (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value)));

const TYPE_CHECKS: Record<FieldType, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  boolean: (value) => typeof value === 'boolean',
  integer: (value) => Number.isInteger(value),
  date: isDate,
  'string[]': (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
  image: (value) => typeof value === 'string' && value.startsWith('./'),
};

// Contract violations in authored frontmatter: a missing required field or a
// value of the wrong type. Fields outside the contract are not this check's
// concern (the vault carries its own, e.g. aliases).
export function frontmatterIssues(name: string, data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const [field, spec] of Object.entries(collectionFields(name))) {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
      if (spec.required) issues.push(`missing required field: ${field}`);
      continue;
    }
    if (!TYPE_CHECKS[spec.type]?.(value)) issues.push(`${field} must be ${spec.type}`);
  }
  return issues;
}
