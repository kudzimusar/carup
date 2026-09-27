import { resolveVisionProvider, providerFromClient } from '../ai/ocrVisionProvider.js';
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { dispatchAutomationWebhook } from '../eventBus/automationWebhookService.js';
import { logger } from '../../utils/logger.js';
import { metricsHub } from '../metrics.js';
import { resolveSchema, OCR_SCHEMA_VERSION, normalizeVin, FIELD_ALIASES, printedLabelsFor } from './documentSchemas.js';
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

// The stamp columns on `vehicles` that ONLY canonicalTrustService.refreshCanonicalTrust() may set
// (INV-TRUST-2). approveDocumentVerification (a governed admin/government reviewer decision, NOT an
// OCR-silent path) owns the number it writes and none of the provenance behind it, so it must clear
// all six in the SAME update — otherwise a write landing after a legitimate refresh would inherit
// that refresh's calculation_version/band/confidence and be published as canonical.
const UNSTAMPED_TRUST_CACHE = Object.freeze({
  trust_calculation_version: null,
  trust_evaluated_at: null,
  trust_band: null,
  trust_confidence: null,
  trust_known_limitations: null,
  trust_evidence_basis: null,
});

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

/**
 * The response schema CarUp asks the provider to fill, derived from the document schema so the
 * two can never drift. Every field is OPTIONAL by construction: a required field would push a
 * reader towards inventing one, and missing must stay missing.
 */
function buildResponseSchema(schema) {
  const properties = {};
  for (const field of Object.keys(schema.fields)) {
    properties[field] = { type: ['string', 'number', 'null'], description: printedLabelsFor(field) || field };
  }
  return {
    name: `carup_${schema.documentClass}_reading`,
    schema: {
      type: 'object',
      properties: {
        document_class_observed: { type: 'string' },
        legible: { type: 'boolean' },
        confidence: { type: ['number', 'null'] },
        unreadable_fields: { type: 'array', items: { type: 'string' } },
        observations: { type: 'array', items: { type: 'string' } },
        fields: { type: 'object', properties },
      },
      required: ['document_class_observed', 'fields'],
    },
  };
}

function buildSystemPrompt(schema) {
  const fieldLines = Object.keys(schema.fields).map((field) => {
    const label = printedLabelsFor(field);
    // Name BOTH CarUp's field and the wording actually printed on the document. A reader that is
    // shown only `first_name` while the card says "Given names" reads the value correctly and
    // then reports it under a key nobody asked for, which lands as a false absence.
    return label ? `  - ${field} — printed on the document as ${label}` : `  - ${field}`;
  }).join('\n');
  return `You are the CarUp document transcription agent. You are shown the actual image or PDF of a ${schema.label}.

Transcribe ONLY what is legibly printed on the attached document.

Fields to look for:
${fieldLines}

${schema.guidance.map((line) => `- ${line}`).join('\n')}

RULES — these override any instinct to be helpful:
- OMIT any field you cannot read on the document. Do not guess, infer, complete or standardise a value.
- Never substitute one field for another, and never repeat a number you read elsewhere on the page into a field it does not belong to.
- Any format or shape described above is a description only. Never copy an example, a format string, or a placeholder into a value.
- Write dates as YYYY-MM-DD only when the day and month are unambiguous on the document; otherwise reproduce them exactly as printed.
- Set document_class_observed to what the attached image actually shows. If it is not a ${schema.label}, say so and return an empty fields object.
- Report confidence only as your own genuine reading confidence for the fields you returned. If you cannot express one, omit it.

OUTPUT FORMAT — absolute: your entire reply must be ONE raw JSON object and nothing else. No prose before or after it, no explanation, no markdown code fences. The first character you emit must be { and the last must be }.

Respond with this JSON object ONLY:
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
    // The configured provider, chosen by CARUP_OCR_PROVIDER alone — there is no fallback to a
    // different provider, so a reading is never attributed to a model that was never asked.
    const configuredProvider = options.visionProvider
      || (options.visionClient ? providerFromClient(options.visionClient, options.visionClientIdentity) : resolveVisionProvider());
    const simulate = !configuredProvider.isConfigured() && DocumentIntelligenceService.isOcrMockAllowed();
    let media = null;

    try {
      if (!configuredProvider.isConfigured() && !simulate) {
        throw new OcrProviderUnavailableError(
          `OCR provider unavailable: ${configuredProvider.id} is selected but ${configuredProvider.requiredEnv.join(' and ')} are not configured for this environment.`,
        );
      }

      media = decodeDocumentPayload(base64Data);

      let rawResponse;
      let provider;
      let model;
      let executionStatus;
      let providerUsage = null;

      if (simulate) {
        // TEST MODE ONLY (NODE_ENV=test + ALLOW_OCR_MOCK=true). The simulated reading is labelled
        // as simulated everywhere it travels so it can never be mistaken for a provider reading.
        provider = 'mock';
        model = 'simulated-document-reader';
        executionStatus = 'simulated';
        rawResponse = JSON.stringify(DocumentIntelligenceService.getMockZimbabweDocument(docType));
      } else {
        provider = configuredProvider.id;
        model = configuredProvider.model;
        executionStatus = 'provider_succeeded';
        // The document bytes go to the provider as image data. Nothing of the payload is logged,
        // echoed into an event, or persisted beyond the candidate fields below.
        const outcome = await configuredProvider.extract({
          systemPrompt: buildSystemPrompt(schema),
          textPrompt: `Declared document type: ${docType}. Transcribe the attached ${schema.label}.`,
          images: [{ mimeType: media.mimeType, base64: media.base64 }],
          jsonSchema: buildResponseSchema(schema),
          timeoutMs: 90_000,
        });
        rawResponse = outcome.content;
        providerUsage = outcome.usage ?? null;
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
        mediaWidthPx: media.dimensions?.widthPx ?? null,
        mediaHeightPx: media.dimensions?.heightPx ?? null,
        // The provider's OWN accounting where it reports one (Workers AI reports neurons and
        // tokens). Null means the provider reported none — it is never estimated.
        providerUsage,
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
        carriedIdentifiers: reading.carriedIdentifiers,
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
        providerUsage,
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

      metricsHub.recordOcrRequest(configuredProvider.id, false, elapsedMs, Number.NaN, false, false);

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
          provider: configuredProvider.id,
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
        provider: configuredProvider.id,
        model: null,
        executionStatus,
        extractionStatus: status,
        confidence: null,
        confidenceReported: false,
        latencyMs: elapsedMs,
      };
    }
  }

  /**
   * Provider output must be a JSON object; anything else is a provider fault, not a reading.
   *
   * `@cf/meta/llama-3.2-11b-vision-instruct` returns a parsed object most of the time but wraps
   * its JSON in prose on a substantial minority of calls, even with an absolute output-format
   * instruction and a response_format schema. So a single balanced JSON object is recovered from
   * the string — and ONLY that. This is not prose parsing: nothing is inferred from the prose, the
   * recovered text must itself be valid JSON and a plain object, and anything else fails closed.
   */
  static parseProviderResponse(rawResponse) {
    let parsed = rawResponse;
    if (typeof rawResponse === 'string') {
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        const opened = rawResponse.indexOf('{');
        const closed = rawResponse.lastIndexOf('}');
        let recovered;
        if (opened > -1 && closed > opened) {
          try { recovered = JSON.parse(rawResponse.slice(opened, closed + 1)); } catch { recovered = undefined; }
        }
        if (recovered === undefined) {
          throw new OcrProviderOutputError('The extraction provider returned output that is not valid JSON.');
        }
        parsed = recovered;
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
    const carriedIdentifiers = [];

    for (const [field, spec] of Object.entries(schema.fields)) {
      // A reader names a field after the words printed on the document. Accepting a synonym for
      // the SAME printed field is not a substitution: FIELD_ALIASES never maps one schema field
      // onto another's value, and unresolvable spellings still land as missing.
      const aliases = FIELD_ALIASES[field] || [];
      let supplied = fields[field] ?? parsed[field] ?? fields[`extracted_${field}`];
      for (const alias of aliases) {
        if (supplied !== undefined && supplied !== null && supplied !== '') break;
        supplied = fields[alias] ?? parsed[alias];
      }
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

    // A registration book prints the chassis number and the VIN once, under a combined label, and
    // a reader that fills only one of the two fields has still READ the identifier. Accepting it
    // for both is not invention: the value is only carried across when it is itself a valid
    // 17-character VIN, so a chassis number that is anything else leaves the VIN missing.
    if (schema.fields.vin && schema.fields.chassis_number) {
      const pairs = [['vin', 'chassis_number'], ['chassis_number', 'vin']];
      for (const [target, source] of pairs) {
        if (additional[target] !== undefined || additional[source] === undefined) continue;
        const carried = normalizeVin(additional[source]);
        if (carried.value === undefined) continue;
        additional[target] = carried.value;
        observedFields.push(target);
        const index = missingFields.indexOf(target);
        if (index > -1) missingFields.splice(index, 1);
        delete unnormalized[target];
        carriedIdentifiers.push({ field: target, from: source });
      }
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
      carriedIdentifiers,
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

  /**
   * PRESERVED on the Trade OS line (O2 OCR convergence).
   *
   * This is a governed admin/government REVIEWER decision surface (mounted at
   * /api/verification, gated by authorizeSessionRole(['admin','government'])), not an OCR-silent
   * authority path: a human decider approves, using the extraction as evidence. It is pinned by
   * the frozen backend/tests/issue164-phase3-trust-authority.test.js (INV-TRUST-2: this write
   * clears the trust stamp) and its T12.1 hardening (it writes NO government registry rows). The
   * O2 branch's wholesale retirement of this surface is a separate programme-authority decision
   * that has not been made on the Trade OS line, so OCR convergence preserves it rather than
   * rolling Trade OS trust/document authority backwards.
   */
  static async approveDocumentVerification(ocrDocumentId, actorId, vin, overrideJustification = 'Admin document review approval') {
    console.log(`👤 [Verification] Admin ${actorId} approving OCR document ${ocrDocumentId} for VIN ${vin}`);
    
    try {
      // 1. Fetch the master OCR document
      const { data: ocrDoc, error: ocrErr } = await supabase
        .from('ocr_documents')
        .select('*')
        .eq('id', ocrDocumentId)
        .single();

      if (ocrErr || !ocrDoc) {
        throw new Error(`OCR document not found: ${ocrDocumentId}`);
      }

      const parsedData = JSON.parse(ocrDoc.extracted_json);
      const confidence = ocrDoc.confidence_score;

      // A. Verify OCR confidence
      if (confidence < 0.80) {
        throw new Error('VERIFICATION_FAILED: Document OCR confidence is too low (< 0.80).');
      }

      // B. Verify document quality. O2 OCR convergence: image quality is NOT measured (the old
      // hash-derived blur/glare/tamper scores were fabrications), so analyzeImageQuality reports
      // qualityPassed=null ("not measured"). Only a genuine, measured failure may block a reviewer
      // approval; "not measured" must not, or an honest extraction could never be approved.
      const quality = this.analyzeImageQuality(ocrDoc.file_path === 'inline_b64' ? 'mock' : ocrDoc.extracted_json);
      if (quality.qualityPassed === false) {
        throw new Error('VERIFICATION_FAILED: Image quality metrics failed (blur, glare, or tampering detected).');
      }

      // Import lazily to avoid circular dependencies
      const { TrustEnforcementEngine } = await import('../trust-service/trustEnforcementEngine.js');

      // C. Verify VIN/chassis/engine/owner match using TrustEnforcementEngine
      const matchCheck = await TrustEnforcementEngine.verifyDocumentDataMatch(vin, ocrDoc.document_type, {
        vin: parsedData.additional_fields?.vin || parsedData.vin,
        owner_name: parsedData.additional_fields?.owner || `${parsedData.first_name || ''} ${parsedData.last_name || ''}`.trim()
      });

      if (!matchCheck.match) {
        throw new Error(`VERIFICATION_FAILED: Metadata mismatch detected. Details: ${JSON.stringify(matchCheck.penalties)}`);
      }

      // D. Fetch vehicle previous state for audit logging
      const { data: vehicle } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
      if (!vehicle) {
        throw new Error(`Vehicle not found for VIN: ${vin}`);
      }

      // E. Write approved registry records
      const timestamp = new Date().toISOString();

      // T12.1 — CarUp does not write government registry records. REMOVED, not disabled.
      //
      // Approving an OCR document used to INSERT a row into `zimra_declarations` or
      // `cvr_ownership_records` — tables that model an act by ZIMRA and the CVR. What the row said
      // was manufactured almost entirely:
      //
      //   · customs_ref_number     'CUS_' + a random uuid          — a ZIMRA reference nobody issued
      //   · port_of_entry          defaulted to 'Beitbridge'       — a port nobody recorded
      //   · duty_calculated_zig    defaulted to 50000              — an amount nobody assessed
      //   · duty_paid_zig          the same 50000                  — asserting duty was PAID
      //   · exchange_rate_used     hardcoded 13.5                  — a rate with no date or source
      //   · customs_stamp_date     today                           — a stamp date nobody stamped
      //   · officer_signature_hash sha256(the ocr document's id)   — a ZIMRA OFFICER'S SIGNATURE,
      //                                                              derived from our own row id
      //   · owner_id_number        defaulted to '29-198427-G-45'   — one real-looking national ID,
      //                                                              on every registration book
      //
      // A photograph read by OCR and approved by a CarUp administrator is evidence that a document
      // exists and what it appeared to say. It is not a customs declaration, and CarUp is not ZIMRA:
      // the provider cannot mint the authority it is supposed to be relying on.
      //
      // What actually happened is already recorded, truthfully and separately: `ocr_documents` holds
      // the document, `ocr_customs_declarations` / `ocr_registration_books` hold what was READ off it
      // with a confidence, and `administrative_overrides` below holds who approved it and why. Those
      // are CarUp's own facts and CarUp may state them. Establishing that duty was assessed and paid
      // is a customs fact, and belongs to whatever authority actually establishes it.

      // F. Write immutable administrative audit log
      const sealData = `${actorId}-${vin}-${ocrDoc.document_type}-${timestamp}`;
      const seal = crypto.createHash('sha512').update(sealData).digest('hex');
      await supabase.from('administrative_overrides').insert({
        actor_id: actorId,
        target_vin: vin,
        override_action: 'ADMIN_APPROVE_OCR_DOCUMENT',
        justification: overrideJustification,
        previous_state: { trust_score: vehicle.trust_score, status: vehicle.status },
        new_state: { trust_score: Math.min(100, (vehicle.trust_score || 80) + 20), status: 'Available' },
        cryptographic_seal: seal,
        ip_address: '127.0.0.1',
        user_agent: 'Console'
      });

      // G. Mark document verified
      await supabase.from('ocr_documents').update({ status: 'Verified' }).eq('id', ocrDocumentId);

      // H. Recalculate dynamic trust score (+20 for verified documentation)
      const baseScore = vehicle.trust_score || 80.0;
      const finalScore = Math.min(100.0, baseScore + 20.0);
      // Only refreshCanonicalTrust() may STAMP a score. This write owns the number and none of the
      // provenance behind it, so it clears the stamp in the same update — otherwise a write landing
      // after a legitimate refresh would keep that refresh's calculation_version and be published as
      // canonical, with a band and confidence still describing the score it replaced.
      await supabase.from('vehicles').update({
        trust_score: finalScore,
        status: 'Available',
        ...UNSTAMPED_TRUST_CACHE,
      }).eq('vin', vin);

      // Emit internal DOCUMENT_VERIFICATION_APPROVED event
      dispatchAutomationWebhook('DOCUMENT_VERIFICATION_APPROVED', { ocrDocumentId, actorId, vin, newTrustScore: finalScore });

      // Write trust history log
      try {
        await supabase.from('trust_score_history').insert({
          entity_type: 'VEHICLE',
          entity_id: vin,
          previous_score: baseScore,
          new_score: finalScore,
          trigger_event: `ADMIN_DOCUMENT_APPROVAL|${ocrDoc.document_type}`,
          timestamp
        });
      } catch (e) {
        console.warn('Skipping score history persistence:', e.message);
      }

      return {
        success: true,
        ocrDocumentId,
        newTrustScore: finalScore,
        status: 'Verified'
      };
    } catch (err) {
      console.error('Document approval failed:', err.message);
      // Emit internal DOCUMENT_VERIFICATION_REJECTED event
      dispatchAutomationWebhook('DOCUMENT_VERIFICATION_REJECTED', { ocrDocumentId, actorId, vin, reason: err.message });
      throw err;
    }
  }
}
