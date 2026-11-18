import { identityConfirmationFields } from './applicantOcrConfirmation.js';

const PUBLIC_OCR_FIELDS = ['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country'];

export function sanitizeOcrResult(extractedData = {}, docType = null) {
  const result = {};
  for (const field of PUBLIC_OCR_FIELDS) {
    if (extractedData[field] !== undefined && extractedData[field] !== null) {
      result[field] = String(extractedData[field]);
    }
  }

  const additional = extractedData.additional_fields;
  if (additional && typeof additional === 'object') {
    result.additional_fields = {};
    const definitions = identityConfirmationFields(docType);
    for (const [key, value] of Object.entries(additional)) {
      const permitted = definitions.length ? definitions.some(field => field.source === 'additional' && field.name === key) : ['vin', 'engine_number', 'make', 'model', 'year', 'plate_number', 'expiry'].includes(key);
      if (permitted && (typeof value === 'string' || typeof value === 'number')) {
        result.additional_fields[key] = String(value);
      }
    }
  }

  return result;
}

export function sanitizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    user_id: session.user_id,
    document_type: session.document_type,
    double_sided: Boolean(session.double_sided),
    status: session.status,
    revision: Number.isInteger(session.version) ? session.version : null,
    workflow_phase: session.workflow_phase || null,
    ocr_execution_status: session.ocr_execution_status || null,
    ocr_confirmation_completed: Boolean(session.ocr_confirmed_at),
    uploaded_sides: {
      front: Boolean(session.front_storage_path),
      back: Boolean(session.back_storage_path),
      selfie: Boolean(session.selfie_storage_path),
    },
    ocr_result: session.ocr_result ? sanitizeOcrResult(session.ocr_result, session.document_type) : null,
    confirmation_fields: identityConfirmationFields(session.document_type),
    confidence_score: session.confidence_score === null || session.confidence_score === undefined
      ? null
      : Number(session.confidence_score),
    review_decision: session.review_decision || null,
    applicant_message: session.status === 'rejected' && session.review_decision === 'reject' && session.reviewed_by
      ? session.failure_reason || null
      : null,
    retry_reason: session.retry_reason || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    submitted_at: session.submitted_at || null,
    ocr_completed_at: session.ocr_completed_at || null,
  };
}
