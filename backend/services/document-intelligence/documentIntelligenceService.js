import { askGeminiVision, GEMINI_VISION_MODEL } from '../ai/GeminiClient.js';
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { dispatchAutomationWebhook } from '../eventBus/automationWebhookService.js';
import { logger } from '../../utils/logger.js';
import { metricsHub } from '../metrics.js';
import { resolveSchema, OCR_SCHEMA_VERSION } from './documentSchemas.js';
import { decodeDocumentPayload, describeMediaQuality } from './documentMedia.js';

/**
 * O2-X1 BOUNDARY: Document Intelligence OBSERVES; domain authorities DECIDE.
 *
 * This module may write ONLY the ocr evidence tables (the master record plus the structured
 * per-document-type candidate rows). Its output is candidate data + provenance + confidence +
 * quality flags — never verified truth. Approving, registering, licensing, trusting or
 * publishing anything on the strength of an extraction is the exclusive business of the owning
 * domain services — Phase 7C identity review, Dealer Compliance, Seller Authority, the vehicle
 * passport/evidence lanes and canonical Trust — each through its own governed, audited decision
 * path. The retired approval/promotion chain must not return; the boundary is pinned by
 * backend/tests/o2-x1-document-intelligence-authority.test.js.
 *
 * TRUTHFULNESS CONTRACT (Live OCR Operationalization):
 *   - extraction reads the actual document bytes through the vision provider; a text prompt
 *     carrying truncated base64 is not extraction and must never return;
 *   - a field is present only because it was observed — there are no runtime defaults, and
 *     missing stays missing;
 *   - confidence is reported only when the provider genuinely supplied it;
 *   - blur, glare and tamper suspicion are NOT measured and are reported as such;
 *   - a provider failure is recorded as a provider failure, distinctly from "no fields found".
 */

const AUTOMATIC_VERIFICATION_CONFIDENCE_FLOOR = 0.8;

class OcrProviderUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OcrProviderUnavailableError';
    this.ocrStatus = 'OCR_Provider_Unavailable';
  }
}

class OcrProviderOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OcrProviderOutputError';
    this.ocrStatus = 'OCR_Provider_Unavailable';
  }
}

function buildSystemPrompt(schema) {
  const fieldLines = Object.keys(schema.fields).map((field) => `  - ${field}`).join('\n');
  return `You are the CarUp document transcription agent. You are shown the actual image or PDF of a ${schema.label}.

Transcribe ONLY what is legibly printed on the attached document.

Fields to look for:
${fieldLines}

${schema.guidance.map((line) => `- ${line}`).join('\n')}

RULES — these override any instinct to be helpful:
- OMIT any field you cannot read on the document. Do not guess, infer, complete or standardise a value.
- Never substitute one field for another, and never repeat a number you read elsewhere on the page into a field it does not belong to.
- Write dates as YYYY-MM-DD only when the day and month are unambiguous on the document; otherwise reproduce them exactly as printed.
- Set document_class_observed to what the attached image actually shows. If it is not a ${schema.label}, say so and return an empty fields object.
- Report confidence only as your own genuine reading confidence for the fields you returned. If you cannot express one, omit it.

Respond with a JSON object ONLY:
{
  "document_class_observed": string,
  "legible": boolean,
  "fields": { <only the fields you actually read> },
  "unreadable_fields": [ <field names present on the document but not legible> ],
  "observations": [ <short factual notes, e.g. "lower third of the card is cut off"> ],
  "confidence": number | null
}`;
}

export class DocumentIntelligenceService {
  /**
   * Mock/sample identity OCR output is allowed ONLY inside the test suite, and
   * only with an explicit flag. It must never be reachable in production or
   * development runtime, where it previously let seeded identities (and failed
   * extractions of non-documents) become "verified".
   */
  static isOcrMockAllowed() {
    return process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
  }

  /**
   * Reports the media facts that can genuinely be read from the payload, and reports blur, glare
   * and tamper suspicion as not measured. CarUp performs no image-quality measurement; the
   * previous implementation derived those three scores from an MD5 hash of the payload, which
   * produced real 'Poor_Image_Quality' and 'Suspected_Tampering' verdicts from a hash digest.
   */
  static analyzeImageQuality(payload) {
    try {
      return describeMediaQuality(decodeDocumentPayload(payload));
    } catch {
      return describeMediaQuality(null);
    }
  }

  /**
   * Runs vision OCR extraction and Zimbabwe document parsing.
   *
   * `options.visionClient` exists for tests that need to observe or simulate the provider call;
   * no runtime caller passes it, which is pinned by the live-OCR regression suite.
   */
  static async extractDocumentData(docType, base64Data, userId, options = {}) {
    if (!userId) {
      // Evidence rows are attribution: outside the test suite a caller must say WHO the
      // extraction belongs to, or the candidate row would be pinned on a phantom user.
      if (process.env.NODE_ENV !== 'test') {
        throw new Error('OCR extraction requires the authenticated user id it is being run for.');
      }
      userId = 'u1';
    }
    const startTime = Date.now();
    const startedAt = new Date().toISOString();
    logger.info('OCR_SERVICE', `OCR extraction started for type: ${docType} by user: ${userId}`);

    // Emit internal DOCUMENT_OCR_STARTED event
    dispatchAutomationWebhook('DOCUMENT_OCR_STARTED', { docType, userId });

    const schema = resolveSchema(docType);
    const simulate = !process.env.GEMINI_API_KEY && DocumentIntelligenceService.isOcrMockAllowed();
    let media = null;

    try {
      if (!process.env.GEMINI_API_KEY && !simulate) {
        throw new OcrProviderUnavailableError(
          'OCR provider unavailable: no vision provider is configured for this environment.',
        );
      }

      media = decodeDocumentPayload(base64Data);

      let rawResponse;
      let provider;
      let model;
      let executionStatus;

      if (simulate) {
        // TEST MODE ONLY (NODE_ENV=test + ALLOW_OCR_MOCK=true). The simulated reading is labelled
        // as simulated everywhere it travels so it can never be mistaken for a provider reading.
        provider = 'mock';
        model = 'simulated-document-reader';
        executionStatus = 'simulated';
        rawResponse = JSON.stringify(DocumentIntelligenceService.getMockZimbabweDocument(docType));
      } else {
        provider = 'gemini';
        model = GEMINI_VISION_MODEL;
        executionStatus = 'provider_succeeded';
        const vision = options.visionClient || askGeminiVision;
        // The document bytes go to the provider as an inline media part. Nothing of the payload
        // is logged, echoed into an event, or persisted beyond the candidate fields below.
        rawResponse = await vision(
          buildSystemPrompt(schema),
          `Declared document type: ${docType}. Transcribe the attached ${schema.label}.`,
          [{ mimeType: media.mimeType, base64: media.base64 }],
          true,
        );
      }

      const parsed = DocumentIntelligenceService.parseProviderResponse(rawResponse);
      const reading = DocumentIntelligenceService.mapObservedFields(schema, parsed);
      const elapsedMs = Date.now() - startTime;

      const confidence = DocumentIntelligenceService.readProviderConfidence(parsed);
      const confidenceReported = confidence !== null;

      const provenance = {
        provider,
        model,
        executionStatus,
        schemaVersion: OCR_SCHEMA_VERSION,
        documentClassRequested: schema.documentClass,
        documentClassObserved: reading.documentClassObserved,
        extractedAt: new Date().toISOString(),
        startedAt,
        latencyMs: elapsedMs,
        confidenceReported,
        imageBytesSent: media.byteSize,
        mimeTypeSent: media.mimeType,
      };

      const qualityIssues = [];
      if (reading.legible === false) qualityIssues.push('provider_reported_illegible');
      if (reading.observedFields.length === 0) qualityIssues.push('no_fields_extracted');
      if (reading.missingCoreFields.length > 0) qualityIssues.push('core_fields_missing');
      if (!confidenceReported) qualityIssues.push('confidence_not_reported');

      let status;
      if (reading.observedFields.length === 0 || reading.missingCoreFields.length > 0) {
        status = 'Pending_Manual_Review';
      } else if (confidenceReported && confidence < AUTOMATIC_VERIFICATION_CONFIDENCE_FLOOR) {
        status = 'Low_Confidence';
      } else {
        status = 'Pending_Verification';
      }

      const success = reading.observedFields.length > 0;

      const extractedData = {
        ...reading.top,
        additional_fields: reading.additional,
        // Present only when the provider genuinely reported one; null means "not reported",
        // never "zero confidence" and never a substituted quality number.
        confidenceScore: confidence,
        observedFields: reading.observedFields,
        missingFields: reading.missingFields,
        unreadableFields: reading.unreadableFields,
        unnormalizedValues: reading.unnormalized,
        observations: reading.observations,
        provenance,
      };

      // Emit internal DOCUMENT_OCR_EXTRACTED event (counts and provenance only — no field values)
      dispatchAutomationWebhook('DOCUMENT_OCR_EXTRACTED', {
        docType, userId, confidence, provider, observedFieldCount: reading.observedFields.length,
      });
      if (confidenceReported && confidence < AUTOMATIC_VERIFICATION_CONFIDENCE_FLOOR) {
        dispatchAutomationWebhook('DOCUMENT_OCR_LOW_CONFIDENCE', { docType, userId, confidence });
      }

      metricsHub.recordOcrRequest(
        provider,
        success,
        elapsedMs,
        // NaN keeps an unreported confidence out of the low-confidence tally: metricsHub counts
        // `confidence < 0.80`, and a substituted 0 would report every silent provider as low.
        confidenceReported ? confidence : Number.NaN,
        false, // image quality is not measured, so it can never be reported as poor
        false, // tampering is not measured, so it can never be reported as suspected
      );

      logger.info('OCR_SUCCESS', `OCR extraction completed in ${elapsedMs}ms. Status resolved to ${status}`, {
        docType, provider, model, executionStatus, status,
        confidenceReported, observedFieldCount: reading.observedFields.length, qualityIssues,
      });

      if (status !== 'Pending_Verification') {
        dispatchAutomationWebhook('DOCUMENT_FLAGGED_FOR_REVIEW', { docType, userId, qualityIssues });
      }

      const id = 'ocr_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      await supabase.from('ocr_documents').insert({
        id,
        user_id: userId,
        document_type: docType,
        file_path: 'inline_upload_not_persisted_by_extraction',
        extracted_json: JSON.stringify(extractedData),
        // confidence_score is NOT NULL in the evidence schema; 0 alongside
        // provenance.confidenceReported=false records "the provider reported none".
        confidence_score: confidenceReported ? confidence : 0,
        status,
        created_at: new Date().toISOString()
      });

      const structured = await DocumentIntelligenceService.persistStructuredCandidate(
        schema, id, reading, confidence,
      );

      return {
        success,
        extractedData,
        qualityMetrics: describeMediaQuality(media, qualityIssues),
        ocrDocumentId: id,
        provider,
        model,
        executionStatus,
        extractionStatus: status,
        confidence,
        confidenceReported,
        latencyMs: elapsedMs,
        structuredCandidate: structured,
        ...(simulate ? { mock: true } : {}),
      };
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      const id = 'ocr_err_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);

      const status = error.ocrStatus || 'OCR_Provider_Unavailable';
      const qualityIssues = [error.qualityIssue || 'extraction_failed'];
      const executionStatus = status === 'OCR_Provider_Unavailable' ? 'provider_failed' : 'not_attempted';

      logger.error('OCR_FAILURE', `Document extraction failed: ${error.message}`, {
        docType, userId, status, executionStatus, qualityIssues, durationMs: elapsedMs,
      });

      metricsHub.recordOcrRequest('gemini', false, elapsedMs, Number.NaN, false, false);

      dispatchAutomationWebhook('DOCUMENT_FLAGGED_FOR_REVIEW', {
        docType, userId, qualityIssues, error: error.message,
      });

      await supabase.from('ocr_documents').insert({
        id,
        user_id: userId,
        document_type: docType,
        file_path: 'not_persisted',
        extracted_json: JSON.stringify({
          error: error.message,
          executionStatus,
          provider: 'gemini',
          attemptedAt: startedAt,
        }),
        confidence_score: 0.0,
        status,
        created_at: new Date().toISOString()
      });

      // FAIL CLOSED: a failed extraction surfaces NO identity fields. There is no sample-document
      // substitution on this path — test-mode simulation happens at the provider boundary above,
      // labelled as simulated, so a real failure can never be dressed up as a reading.
      return {
        success: false,
        error: error.message,
        ocrFailureReason: 'AI_OCR_EXTRACTION_FAILED',
        qualityMetrics: describeMediaQuality(media, qualityIssues),
        ocrDocumentId: id,
        provider: 'gemini',
        model: null,
        executionStatus,
        extractionStatus: status,
        confidence: null,
        confidenceReported: false,
        latencyMs: elapsedMs,
      };
    }
  }

  /** Provider output must be a JSON object; anything else is a provider fault, not a reading. */
  static parseProviderResponse(rawResponse) {
    let parsed = rawResponse;
    if (typeof rawResponse === 'string') {
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        throw new OcrProviderOutputError('The extraction provider returned output that is not valid JSON.');
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OcrProviderOutputError('The extraction provider returned output in an unrecognised shape.');
    }
    return parsed;
  }

  /** Confidence survives only if the provider actually stated a usable number. */
  static readProviderConfidence(parsed) {
    const raw = parsed.confidence ?? parsed.confidenceScore ?? parsed.confidence_score;
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    return value;
  }

  /**
   * Projects the provider's reading onto the document schema. Only observed, normalizable values
   * survive; every other field is reported as missing. A value the provider supplied but that
   * could not be normalized (an ambiguous date, a string that is not a VIN) is preserved as an
   * unnormalized observation rather than silently coerced.
   */
  static mapObservedFields(schema, parsed) {
    const fields = (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields))
      ? parsed.fields
      : parsed;

    const top = {};
    const additional = {};
    const observedFields = [];
    const missingFields = [];
    const unnormalized = {};

    for (const [field, spec] of Object.entries(schema.fields)) {
      const supplied = fields[field] ?? parsed[field] ?? fields[`extracted_${field}`];
      const outcome = spec.normalize(supplied);
      if (outcome.value === undefined) {
        missingFields.push(field);
        if (outcome.unnormalized !== undefined) {
          unnormalized[field] = { value: outcome.unnormalized, reason: outcome.reason || 'not_normalizable' };
        }
        continue;
      }
      observedFields.push(field);
      if (spec.target === 'top') top[field] = outcome.value; else additional[field] = outcome.value;
    }

    const missingCoreFields = (schema.coreFields || []).filter((field) => !observedFields.includes(field));
    const asStringArray = (value) => (Array.isArray(value)
      ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
      : []);

    return {
      top,
      additional,
      observedFields,
      missingFields,
      missingCoreFields,
      unnormalized,
      unreadableFields: asStringArray(parsed.unreadable_fields),
      observations: asStringArray(parsed.observations),
      documentClassObserved: typeof parsed.document_class_observed === 'string'
        ? parsed.document_class_observed.trim() || null
        : null,
      legible: typeof parsed.legible === 'boolean' ? parsed.legible : null,
    };
  }

  /**
   * Writes the structured candidate row only when every NOT NULL column of the target table was
   * genuinely observed — including the confidence the column demands. When the reading is
   * incomplete no row is written: absence of a row is absence of a candidate, which is what the
   * placeholder values ('Unknown', 'N/A', today's date, sex 'M', year 2020) used to conceal.
   */
  static async persistStructuredCandidate(schema, ocrDocumentId, reading, confidence) {
    if (!schema.structured) {
      return { table: null, written: false, skippedReason: 'no_structured_table_for_document_class' };
    }
    const { table, build, requiredColumns } = schema.structured;

    if (confidence === null) {
      return { table, written: false, skippedReason: 'provider_reported_no_confidence' };
    }

    const candidate = build(reading.top, reading.additional);
    const missingColumns = requiredColumns.filter((column) => candidate[column] === undefined || candidate[column] === null);
    if (missingColumns.length > 0) {
      return { table, written: false, skippedReason: 'required_fields_not_observed', missingColumns };
    }

    const row = { ocr_document_id: ocrDocumentId, raw_verification_confidence: confidence };
    for (const [column, value] of Object.entries(candidate)) {
      if (value !== undefined && value !== null) row[column] = value;
    }

    try {
      await supabase.from(table).insert(row);
      return { table, written: true, skippedReason: null };
    } catch (persistenceError) {
      logger.warn('OCR_STRUCTURED_PERSISTENCE', `Structured OCR persistence failed for ${table}`, {
        message: persistenceError.message,
      });
      return { table, written: false, skippedReason: 'persistence_error' };
    }
  }

  /**
   * Sample Zimbabwe documents for the test-mode simulated reader. Reachable only through
   * isOcrMockAllowed() (NODE_ENV=test + ALLOW_OCR_MOCK=true), and always labelled provider
   * 'mock' / executionStatus 'simulated' in everything it produces.
   */
  static getMockZimbabweDocument(docType) {
    const schema = resolveSchema(docType);
    switch (schema.documentClass) {
      case 'zimbabwe_national_id':
        return {
          document_class_observed: 'zimbabwe_national_id',
          legible: true,
          confidence: 0.95,
          fields: {
            first_name: 'Tinashe',
            last_name: 'Moyo',
            national_id_number: '29-198427-G-45',
            date_of_birth: '1984-06-15',
            country: 'Zimbabwe',
            sex: 'M',
            place_of_birth: 'Harare',
          },
        };
      case 'passport':
        return {
          document_class_observed: 'passport',
          legible: true,
          confidence: 0.98,
          fields: {
            first_name: 'Ruvimbo',
            last_name: 'Chigumba',
            national_id_number: 'ZN0943248',
            passport_number: 'ZN0943248',
            date_of_birth: '1992-11-22',
            country: 'Zimbabwe',
            nationality: 'Zimbabwean',
            expiry: '2030-05-18',
          },
        };
      case 'drivers_licence':
        return {
          document_class_observed: 'drivers_licence',
          legible: true,
          confidence: 0.93,
          fields: {
            first_name: 'Tapiwa',
            last_name: 'Ncube',
            national_id_number: 'DL-4471902',
            licence_number: 'DL-4471902',
            licence_classes: '4, 2',
            date_of_birth: '1990-02-08',
            country: 'Zimbabwe',
            expiry: '2029-02-07',
          },
        };
      case 'vehicle_registration_book':
        return {
          document_class_observed: 'vehicle_registration_book',
          legible: true,
          confidence: 0.91,
          fields: {
            vin: 'JTDBR32E870123456',
            chassis_number: 'JTDBR32E870123456',
            engine_number: '1NZ-FE-4829384',
            make: 'Toyota',
            model: 'Corolla',
            year: 2018,
            plate_number: 'AEB 4729',
            owner_name: 'Croco Motors',
            country: 'Zimbabwe',
          },
        };
      case 'customs_declaration':
        return {
          document_class_observed: 'customs_declaration',
          legible: true,
          confidence: 0.9,
          fields: {
            vin: 'JTDBR32E870123456',
            bill_entry_number: 'BOE-2026-884213',
            duty_value_zig: 48250.5,
            currency: 'ZiG',
            importer_name: 'Croco Motors',
            stamp_date: '2026-03-14',
            entry_point: 'Beitbridge',
            country: 'Zimbabwe',
          },
        };
      default:
        return {
          document_class_observed: 'business_document',
          legible: true,
          confidence: 0.88,
          fields: {
            legal_name: 'Croco Motors (Private) Limited',
            trading_name: 'Croco Motors',
            registration_number: '10234/2016',
            tax_id: '2000123456',
            physical_address: '12 Samora Machel Ave, Harare',
            country: 'Zimbabwe',
          },
        };
    }
  }
}
