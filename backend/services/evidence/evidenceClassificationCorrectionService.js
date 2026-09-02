/**
 * Governed evidence classification correction — Operations Control Plane M1.
 *
 * A reviewer may correct the CANONICAL classification (evidence_class +
 * evidence_subtype) of a stored evidence row when the stored classification is
 * proven wrong. This is a bounded, audited decision — never an unrestricted
 * PATCH of arbitrary evidence fields:
 *
 *   - only evidence_class / evidence_subtype change; the artifact, its storage
 *     locator, checksum, visibility, verification status and the historical
 *     legacy evidence_type are untouched (G13: history is preserved);
 *   - the previous classification is appended to metadata.classification_history
 *     so the original interpretation remains reconstructable;
 *   - the decision is audited to trust_audit_events FAIL-CLOSED (G6/G12): if the
 *     audit cannot be written the correction does not happen;
 *   - a chain-of-custody 'corrected' provenance event is recorded (best-effort,
 *     same posture as upload provenance).
 *
 * Authorization is enforced by the route (and, from M5, the Operations
 * capability policy). This service additionally refuses uploader self-correction
 * (G5 — no self-certification).
 */
import { isValidClass, isValidSubtype } from './evidenceTaxonomy.js';
import { recordProvenanceEvent } from './provenanceService.js';
import { logAuditEvent } from '../auditLogger.js';

export const EVIDENCE_CLASSIFICATION_CORRECTED_EVENT = 'EVIDENCE_CLASSIFICATION_CORRECTED';

export class ClassificationCorrectionError extends Error {
  constructor(message, code = 'CLASSIFICATION_CORRECTION_INVALID', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {object} client Supabase-compatible client.
 * @param {object} input
 * @param {string} input.vin
 * @param {string} input.evidenceId
 * @param {string} input.evidenceClass  target canonical class
 * @param {string} input.evidenceSubtype target canonical subtype (required)
 * @param {string} input.reason  mandatory human reason
 * @param {object} input.actor  { id, role, tenantId }
 * @param {object} [input.requestContext]  { requestId, sourceRoute, ipAddress, userAgent }
 */
export async function correctEvidenceClassification(client, {
  vin,
  evidenceId,
  evidenceClass,
  evidenceSubtype,
  reason,
  actor,
  requestContext = {},
}) {
  if (!vin || !evidenceId) {
    throw new ClassificationCorrectionError('vin and evidenceId are required');
  }
  if (!actor?.id || !actor?.role) {
    throw new ClassificationCorrectionError('An attributable actor is required', 'CLASSIFICATION_CORRECTION_UNATTRIBUTED', 403);
  }
  if (!reason || !String(reason).trim()) {
    throw new ClassificationCorrectionError('A reason is required for a classification correction');
  }
  if (!isValidClass(evidenceClass)) {
    throw new ClassificationCorrectionError(`Unknown evidence_class '${evidenceClass}'`);
  }
  if (!evidenceSubtype || !isValidSubtype(evidenceClass, evidenceSubtype)) {
    throw new ClassificationCorrectionError(
      `Subtype '${evidenceSubtype}' is not valid for class '${evidenceClass}'`
    );
  }

  const { data: row, error: rowErr } = await client
    .from('vehicle_evidence')
    .select('id, vin, evidence_type, evidence_class, evidence_subtype, uploaded_by, metadata')
    .eq('id', evidenceId)
    .eq('vin', vin)
    .maybeSingle();
  if (rowErr) {
    throw new ClassificationCorrectionError(`Evidence read failed: ${rowErr.message}`, 'CLASSIFICATION_CORRECTION_READ_FAILED', 500);
  }
  if (!row) {
    throw new ClassificationCorrectionError('Evidence not found for this vehicle', 'CLASSIFICATION_CORRECTION_NOT_FOUND', 404);
  }

  // G5 — the uploader must not correct the meaning of their own submission.
  if (row.uploaded_by && row.uploaded_by === actor.id && actor.role !== 'admin') {
    throw new ClassificationCorrectionError(
      'The uploader cannot correct the classification of their own evidence',
      'CLASSIFICATION_CORRECTION_SELF',
      403
    );
  }

  if (row.evidence_class === evidenceClass && row.evidence_subtype === evidenceSubtype) {
    return { changed: false, evidenceId, evidence_class: evidenceClass, evidence_subtype: evidenceSubtype };
  }

  const correctedAt = new Date().toISOString();
  const historyEntry = {
    previous_evidence_class: row.evidence_class ?? null,
    previous_evidence_subtype: row.evidence_subtype ?? null,
    corrected_evidence_class: evidenceClass,
    corrected_evidence_subtype: evidenceSubtype,
    corrected_by: actor.id,
    corrected_by_role: actor.role,
    corrected_at: correctedAt,
    reason: String(reason).trim(),
    request_id: requestContext.requestId ?? null,
  };

  // Audit FIRST, fail closed: a correction that cannot be attributed does not happen.
  const audit = await logAuditEvent(client, {
    eventType: EVIDENCE_CLASSIFICATION_CORRECTED_EVENT,
    vin,
    actorUserId: actor.id,
    actorRole: actor.role,
    actorTenantId: actor.tenantId ?? null,
    actorType: 'user',
    evidenceIds: [evidenceId],
    previousValue: {
      evidence_class: row.evidence_class ?? null,
      evidence_subtype: row.evidence_subtype ?? null,
    },
    newValue: {
      evidence_class: evidenceClass,
      evidence_subtype: evidenceSubtype,
    },
    reason: String(reason).trim(),
    sourceRoute: requestContext.sourceRoute ?? '/api/vehicles/:vin/evidence/:evidenceId/classification',
    requestId: requestContext.requestId ?? null,
    ipAddress: requestContext.ipAddress ?? null,
    userAgent: requestContext.userAgent ?? null,
  });
  if (!audit?.success) {
    throw new ClassificationCorrectionError(
      audit?.error || 'Classification correction audit could not be recorded',
      'CLASSIFICATION_CORRECTION_AUDIT_FAILED',
      500
    );
  }

  const previousHistory = Array.isArray(row.metadata?.classification_history)
    ? row.metadata.classification_history
    : [];
  const nextMetadata = {
    ...(row.metadata || {}),
    classification_history: [...previousHistory, historyEntry],
  };

  const { data: updated, error: updateErr } = await client
    .from('vehicle_evidence')
    .update({
      evidence_class: evidenceClass,
      evidence_subtype: evidenceSubtype,
      metadata: nextMetadata,
      updated_at: correctedAt,
    })
    .eq('id', evidenceId)
    .eq('vin', vin)
    .select('id, vin, evidence_type, evidence_class, evidence_subtype, metadata')
    .single();
  if (updateErr) {
    throw new ClassificationCorrectionError(`Classification update failed: ${updateErr.message}`, 'CLASSIFICATION_CORRECTION_WRITE_FAILED', 500);
  }

  // Chain-of-custody event (best-effort — never blocks a governed, audited decision).
  try {
    await recordProvenanceEvent(client, {
      evidenceId,
      vin,
      eventType: 'corrected',
      actorUserId: actor.id,
      actorRole: actor.role,
      actorType: 'user',
      sourceRoute: requestContext.sourceRoute ?? null,
      requestId: requestContext.requestId ?? null,
      ipAddress: requestContext.ipAddress ?? null,
      details: historyEntry,
    });
  } catch (err) {
    console.warn('[Provenance] failed to record classification correction:', err.message);
  }

  return { changed: true, ...updated };
}

export default { correctEvidenceClassification, EVIDENCE_CLASSIFICATION_CORRECTED_EVENT, ClassificationCorrectionError };
