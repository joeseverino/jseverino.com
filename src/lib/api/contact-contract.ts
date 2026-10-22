// The request schema and runtime limits of contracts/contact.v1.json, applied to a submission.
import contract from '../../../contracts/contact.v1.json' with { type: 'json' };

type ContractProperty = {
  readonly type: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly format?: string;
  readonly 'x-purpose'?: string;
};

export type ContactField = keyof typeof contract.request.properties;
export type ContactFields = Record<ContactField, string>;
export const CONTACT_RUNTIME = contract.runtime;
export const CONTACT_PROPERTIES: Readonly<Record<ContactField, ContractProperty>> = contract.request.properties;
const REQUIRED = new Set<string>(contract.request.required);
// Object.entries widens keys to string; these are the contract's own fields.
const FIELDS = Object.entries(CONTACT_PROPERTIES) as [ContactField, ContractProperty][];

export type ContactValidation =
  | { ok: true; value: ContactFields }
  | { ok: false; reason: 'invalid' | 'missing' | 'too_short' | 'too_long' | 'email' | 'uri'; field?: ContactField };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactPayload(payload: unknown): ContactValidation {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid' };
  }
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).some((key) => !Object.hasOwn(CONTACT_PROPERTIES, key))) {
    return { ok: false, reason: 'invalid' };
  }
  const value: Partial<ContactFields> = {};
  for (const [name, spec] of FIELDS) {
    const raw = source[name];
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, reason: 'invalid' };
    const normalized = typeof raw === 'string' ? raw.trim() : '';
    if (REQUIRED.has(name) && normalized.length === 0) {
      return { ok: false, reason: 'missing', field: name };
    }
    if (normalized && spec.minLength !== undefined && normalized.length < spec.minLength) {
      return { ok: false, reason: 'too_short', field: name };
    }
    if (spec.maxLength !== undefined && normalized.length > spec.maxLength) {
      return { ok: false, reason: 'too_long' };
    }
    if (spec.format === 'email' && normalized && !EMAIL.test(normalized)) {
      return { ok: false, reason: 'email', field: name };
    }
    if (spec.format === 'uri' && normalized) {
      const protocol = URL.parse(normalized)?.protocol;
      if (protocol !== 'http:' && protocol !== 'https:') return { ok: false, reason: 'uri', field: name };
    }
    value[name] = normalized;
  }
  // The loop assigned every contract field or returned early.
  return { ok: true, value: value as ContactFields };
}
