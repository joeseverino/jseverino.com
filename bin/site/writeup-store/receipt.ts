// Receipts for completed writes: audit and cache-invalidation evidence, never a second source of truth.
import { jsonFingerprint as fingerprint } from '../../../src/lib/canonical-json.ts';

export { fingerprint };

export interface MutationReceipt {
  receipt_version: 1;
  operation: string;
  entity: { type: string; id: string };
  changed_fields: string[];
  affected_projections: string[];
  idempotency_key: string;
  metadata: Record<string, unknown>;
  before_fingerprint?: string;
  after_fingerprint?: string;
}

export interface ReceiptInput {
  operation: string;
  entityType: string;
  entityId: string;
  changedFields?: readonly string[];
  before?: unknown;
  after?: unknown;
  affectedProjections?: readonly string[];
  metadata?: Record<string, unknown>;
}

export function receipt(input: ReceiptInput): MutationReceipt {
  const changed = [...(input.changedFields ?? [])].sort();
  const after = input.after === undefined ? undefined : fingerprint(input.after);
  return {
    receipt_version: 1,
    operation: input.operation,
    entity: { type: input.entityType, id: input.entityId },
    changed_fields: changed,
    affected_projections: [...(input.affectedProjections ?? [])].sort(),
    idempotency_key: fingerprint({
      operation: input.operation,
      entity_type: input.entityType,
      entity_id: input.entityId,
      after_fingerprint: after ?? null,
      changed_fields: changed,
    }),
    metadata: { ...input.metadata },
    ...(input.before === undefined ? {} : { before_fingerprint: fingerprint(input.before) }),
    ...(after === undefined ? {} : { after_fingerprint: after }),
  };
}
