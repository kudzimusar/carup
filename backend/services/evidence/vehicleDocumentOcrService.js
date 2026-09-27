import { supabase } from '../../db/supabase.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { downloadFromStorage } from '../storage/storageService.js';
import { persistExtractions } from './extractionService.js';
import { isDocumentArtifactRow, resolveSemanticClassification } from './evidenceTaxonomy.js';
import { isSellerAuthorityEffectivelyDenied } from '../seller/sellerAuthorityService.js';
import { logAuditEvent } from '../auditLogger.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

/**
 * OCR Path Convergence — local vehicle documents.
 *
 * Document Intelligence OBSERVES. Vehicle Evidence / reviewers DECIDE.
 * This service may create field-level extraction CANDIDATES only. It never changes:
 *   - vehicle_evidence.verification_status;
 *   - vehicles ownership / seller authority / registration lifecycle;
 *   - publication state;
 *   - canonical Trust.
 *
 * Semantic meaning comes from canonical evidence_class + evidence_subtype. We intentionally do
 * NOT guess an OCR schema from the legacy evidence_type field: a compatibility label is not a
 * document-class authority.
 */

const PLATFORM_OCR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government']);
const VEHICLE_OCR_ROLES = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government']);

const DOCUMENT_CONTRACTS = Object.freeze({
  'registration:registration_book': Object.freeze({
    documentType: 'registration_book',
    fields: Object.freeze([
      ['vin', 'vin'],
      ['chassis_number', 'chassis_number'],
      ['engine_number', 'engine_number'],
      ['make', 'make'],
      ['model', 'model'],
      ['year', 'year'],
      ['plate_number', 'plate_number'],
      ['registration_number', null],
      ['owner_name', null],
      ['date_of_registration', null],
      ['country', null],
    ]),
  }),
  'import:customs_entry': Object.freeze({
    documentType: 'customs_declaration',
    fields: Object.freeze([
      ['vin', 'vin'],
      ['bill_entry_number', null],
      ['duty_value_zig', null],
      ['currency', null],
      ['importer_name', null],
      ['stamp_date', null],
      ['entry_point', null],
      ['country', null],
    ]),
  }),
});

function actorId(actor = {}) {
  return actor.id || actor.userId || null;
}

function normalizeVin(vin) {
  return String(vin || '').trim().toUpperCase();
}

export function resolveVehicleOcrDocumentContract(evidence = {}) {
  const semantic = resolveSemanticClassification(evidence);
  if (semantic.semantic_source !== 'canonical') return null;
  return DOCUMENT_CONTRACTS[`${semantic.evidence_class}:${semantic.evidence_subtype}`] || null;
}

function observedValue(extracted = {}, field) {
  if (extracted[field] !== undefined && extracted[field] !== null) return extracted[field];
  const additional = extracted.additional_fields;
  if (additional && additional[field] !== undefined && additional[field] !== null) return additional[field];
  return undefined;
}

export function toVehicleExtractionFields(contract, ocrResult = {}) {
  if (!contract) return [];
  const extracted = ocrResult.extractedData || {};
  const sourceModel = [ocrResult.provider, ocrResult.model].filter(Boolean).join('/') || null;
  const rawConfidence = extracted.confidenceScore;
  const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === ''
    ? null
    : (Number.isFinite(Number(rawConfidence)) ? Number(rawConfidence) : null);

  const fields = [];
  for (const [fieldName, comparedVehicleField] of contract.fields) {
    const value = observedValue(extracted, fieldName);
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;
    fields.push({
      fieldName,
      rawValue: value,
      comparedVehicleField,
      confidence,
      sourceModel,
      aiJobId: null,
    });
  }
  return fields;
}

function assertVehicleOcrActor(actor = {}) {
  const userId = actorId(actor);
  if (!userId) throw new ValidationError('Authenticated user context is required.');

  const role = String(actor.role || actor.effectiveRole || '').toLowerCase();
  if (!VEHICLE_OCR_ROLES.has(role)) {
    throw new ForbiddenError(`Role '${role || 'unknown'}' cannot process private vehicle documents with OCR.`);
  }

  // The route already composes authorizeRole + requireProvenIdentity. The service repeats the
  // consequential part so a future internal caller cannot bypass it by importing this function
  // directly. Tests intentionally omit authenticationMethod and remain injectable under NODE_ENV=test.
  if (process.env.NODE_ENV !== 'test' && actor.authenticationMethod !== 'session') {
    throw new ForbiddenError('Vehicle document OCR requires a proven authenticated session.');
  }

  return { userId, role };
}

async function requireVehicleScope(client, actor, vin) {
  const { userId, role } = assertVehicleOcrActor(actor);

  const { data: vehicle, error } = await client
    .from('vehicles')
    .select('vin, owner_id, current_seller_id, tenant_id, publication_status, status, registration_status')
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(`Vehicle OCR scope read failed: ${error.message}`);
  if (!vehicle) throw new NotFoundError('Vehicle not found.');

  if (PLATFORM_OCR_ROLES.has(role)) return vehicle;

  const ownsVehicle = vehicle.owner_id && vehicle.owner_id === userId;
  const isCurrentSeller = vehicle.current_seller_id && vehicle.current_seller_id === userId;
  // Tenant membership alone is not enough to read/process a private vehicle document. Only the
  // governed dealer context may use the organizational relationship; an owner/member who merely
  // belongs to the same tenant must not inherit dealer evidence authority by supplying tenantId.
  const isDealerTenant = role === 'dealer'
    && vehicle.tenant_id
    && actor.tenantId
    && vehicle.tenant_id === actor.tenantId;
  if (!ownsVehicle && !isCurrentSeller && !isDealerTenant) {
    throw new ForbiddenError('You do not have owner, current-seller, or governed dealer scope over this vehicle.');
  }

  // Canonical owner access is evidence preparation, not Seller Authority. A non-owner relationship,
  // however, may be stale after an ownership transfer or explicit revocation, so it must survive the
  // same effective-denial check used by the Seller lifecycle before it can reach private evidence.
  if (!ownsVehicle) {
    const denial = await isSellerAuthorityEffectivelyDenied(client, { vin, userId, vehicle });
    if (denial.denied) {
      throw new ForbiddenError('Your seller relationship to this vehicle no longer authorizes private document processing.');
    }
  }

  return vehicle;
}

async function loadEvidenceForOcr(client, vin, evidenceId) {
  const { data: evidence, error } = await client
    .from('vehicle_evidence')
    .select('id, vin, evidence_type, evidence_class, evidence_subtype, storage_bucket, file_path, mime_type, verification_status, uploaded_by')
    .eq('id', evidenceId)
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw new Error(`Vehicle evidence read failed: ${error.message}`);
  if (!evidence) throw new NotFoundError('Vehicle evidence item not found.');
  if (!isDocumentArtifactRow(evidence)) {
    throw new ValidationError('Only a canonical vehicle document artifact can be sent to OCR.');
  }
  if (evidence.storage_bucket !== 'ocr-documents') {
    throw new ValidationError('Vehicle OCR requires an artifact stored in the private document bucket.');
  }
  if (!evidence.file_path) throw new ValidationError('Vehicle evidence has no private storage path.');

  const requiredPrefix = `${vin}/`;
  if (String(evidence.file_path).includes('..') || String(evidence.file_path).startsWith('/')
      || !String(evidence.file_path).toUpperCase().startsWith(requiredPrefix.toUpperCase())) {
    throw new ValidationError('Vehicle evidence storage path is outside this vehicle scope.');
  }
  return evidence;
}

/**
 * Execute OCR against one already-uploaded vehicle evidence document.
 * Dependencies are injectable for offline integration tests; runtime uses the canonical services.
 */
export async function runVehicleEvidenceOcr(
  client = supabase,
  actor = {},
  vinInput,
  evidenceId,
  options = {},
) {
  const vin = normalizeVin(vinInput);
  if (!vin) throw new ValidationError('VIN is required.');
  if (!evidenceId) throw new ValidationError('evidenceId is required.');

  await requireVehicleScope(client, actor, vin);
  const evidence = await loadEvidenceForOcr(client, vin, evidenceId);
  const contract = resolveVehicleOcrDocumentContract(evidence);
  if (!contract) {
    const semantic = resolveSemanticClassification(evidence);
    throw new ValidationError(
      `OCR is not enabled for vehicle document ${semantic.evidence_class || 'unclassified'}/${semantic.evidence_subtype || 'unclassified'}. `
      + 'Supported canonical vehicle documents are registration/registration_book and import/customs_entry.',
    );
  }

  const storage = options.storage || { downloadFromStorage };
  const file = await storage.downloadFromStorage('ocr-documents', evidence.file_path);
  if (!file?.buffer?.length) throw new ValidationError('Vehicle evidence file is empty.');
  const mimeType = file.mimeType || evidence.mime_type || 'application/pdf';
  const dataUri = `data:${mimeType};base64,${file.buffer.toString('base64')}`;

  const ocr = options.ocr || DocumentIntelligenceService;
  const ocrResult = await ocr.extractDocumentData(contract.documentType, dataUri, actorId(actor));
  const fields = toVehicleExtractionFields(contract, ocrResult);

  let persistence = { extractions: [], mismatch_count: 0, pending_review_count: 0 };
  if (ocrResult.success && fields.length > 0) {
    const persist = options.persistExtractions || persistExtractions;
    persistence = await persist({
      evidenceId: evidence.id,
      vin,
      documentType: contract.documentType,
      fields,
    });
  }

  // Audit is secondary evidence about the operation; it is not allowed to mint or withhold the
  // OCR candidates. Never include extracted values or storage paths in this event.
  const audit = options.audit || logAuditEvent;
  try {
    await audit(client, {
      req: options.req,
      event_type: 'VEHICLE_DOCUMENT_OCR_OBSERVED',
      actor_user_id: actorId(actor),
      actor_role: actor.role || null,
      actor_tenant_id: actor.tenantId || null,
      source_route: '/api/vehicles/:vin/evidence/:evidenceId/run-ocr',
      targetType: 'evidence',
      targetId: evidence.id,
      vin,
      evidence_ids: [evidence.id],
      new_value: {
        provider: ocrResult.provider || null,
        model: ocrResult.model || null,
        execution_status: ocrResult.executionStatus || null,
        ocr_success: Boolean(ocrResult.success),
        observed_field_count: fields.length,
        candidate_rows: persistence.extractions?.length || 0,
      },
      reason: 'OCR observations recorded as review-pending vehicle-document candidates only.',
    });
  } catch (error) {
    console.warn('[vehicle-document-ocr] audit write failed:', error?.message || error);
  }

  return {
    success: Boolean(ocrResult.success),
    vin,
    evidence_id: evidence.id,
    document_type: contract.documentType,
    provider: ocrResult.provider || null,
    model: ocrResult.model || null,
    execution_status: ocrResult.executionStatus || null,
    confidence: ocrResult.confidence ?? ocrResult.extractedData?.confidenceScore ?? null,
    observed_fields: fields.map((field) => field.fieldName),
    candidates_persisted: persistence.extractions?.length || 0,
    mismatch_count: persistence.mismatch_count || 0,
    pending_review_count: persistence.pending_review_count || 0,
    evidence_verification_status: evidence.verification_status || null,
    authority_effects: {
      identity_verified: false,
      dealer_compliant: false,
      seller_authorised: false,
      vehicle_registered: false,
      vehicle_trusted: false,
      listing_published: false,
    },
  };
}

export default { runVehicleEvidenceOcr, resolveVehicleOcrDocumentContract, toVehicleExtractionFields };
