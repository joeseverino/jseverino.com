import { contactContract as contract } from '../generated/contact-contract.ts';

type ContractProperty = {
  type: string;
  minLength?: number;
  maxLength?: number;
  format?: string;
  'x-purpose'?: string;
};

export type ContactPayload = Record<string, unknown>;
export const CONTACT_RUNTIME = contract.runtime;
export const CONTACT_PROPERTIES = contract.request.properties as Record<string, ContractProperty>;
export const CONTACT_REQUIRED = new Set<string>(contract.request.required);

export type ContactValidation =
  | { ok: true; value: Record<string, string> }
  | { ok: false; reason: 'invalid' | 'missing' | 'too_long' | 'email' | 'uri'; field?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactPayload(payload: unknown): ContactValidation {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid' };
  }
  const source = payload as ContactPayload;
  if (Object.keys(source).some((key) => !(key in CONTACT_PROPERTIES))) {
    return { ok: false, reason: 'invalid' };
  }
  const value: Record<string, string> = {};
  for (const [name, spec] of Object.entries(CONTACT_PROPERTIES)) {
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
  return { ok: true, value };
}
