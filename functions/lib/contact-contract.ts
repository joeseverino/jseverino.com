import { contactContract as contract } from '../generated/contact-contract.ts';

type ContractProperty = {
  readonly type: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly format?: string;
  readonly 'x-purpose'?: string;
};

export type ContactField = keyof typeof contract.request.properties;
export type ContactFields = Record<ContactField, string>;
export type ContactPayload = Record<string, unknown>;
export const CONTACT_RUNTIME = contract.runtime;
export const CONTACT_PROPERTIES: Readonly<Record<ContactField, ContractProperty>> = contract.request.properties;
export const CONTACT_REQUIRED = new Set<string>(contract.request.required);
// Object.entries widens keys to string; these are the contract's own fields.
const FIELDS = Object.entries(CONTACT_PROPERTIES) as [ContactField, ContractProperty][];

export type ContactValidation =
  | { ok: true; value: ContactFields }
  | { ok: false; reason: 'invalid' | 'missing' | 'too_long' | 'email' | 'uri'; field?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactPayload(payload: unknown): ContactValidation {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid' };
  }
  const source = payload as ContactPayload;
  if (Object.keys(source).some((key) => !Object.hasOwn(CONTACT_PROPERTIES, key))) {
    return { ok: false, reason: 'invalid' };
  }
  const value: Partial<ContactFields> = {};
  for (const [name, spec] of FIELDS) {
    const raw = source[name];
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, reason: 'invalid' };
    const normalized = typeof raw === 'string' ? raw.trim() : '';
    if (CONTACT_REQUIRED.has(name) && normalized.length === 0) {
      return { ok: false, reason: 'missing', field: name };
    }
    if (spec.maxLength !== undefined && normalized.length > spec.maxLength) {
      return { ok: false, reason: 'too_long' };
    }
    if (spec.format === 'email' && normalized && !EMAIL.test(normalized)) {
      return { ok: false, reason: 'email', field: name };
    }
    if (spec.format === 'uri' && normalized) {
      try {
        const url = new URL(normalized);
        if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'uri', field: name };
      } catch {
        return { ok: false, reason: 'uri', field: name };
      }
    }
    value[name] = normalized;
  }
  // The loop assigned every contract field or returned early.
  return { ok: true, value: value as ContactFields };
}
