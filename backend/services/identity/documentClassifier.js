/**
 * Phase 7C — Document classification service.
 *
 * Two-pass strategy:
 *   Pass 1: Deterministic checks (MIME, size, entropy, hashes)
 *   Pass 2: Constrained vision classification through the GOVERNED PROVIDER BOUNDARY
 *           (CARUP_OCR_PROVIDER, default cloudflare/@cf/qwen/qwen3.8-27b) — never a vendor
 *           imported directly here, and never an automatic fallback to another vendor.
 *   Pass 3: Extraction only if Pass 2 qualifies
 *
 * Hallucinated identity fields from non-documents are NEVER persisted as
 * applicant-facing data.
 */

import crypto from 'crypto';
import { validateEvidenceImages } from './evidenceValidation.js';
import { resolveVisionProvider } from '../ai/ocrVisionProvider.js';
import { supabase } from '../../db/supabase.js';

/** Detect the image MIME type from magic bytes; defaults to JPEG. */
function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 4) return 'image/jpeg';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'; // RIFF container
  return 'image/jpeg';
}

export const EVIDENCE_CLASSIFICATION = Object.freeze({
  NOT_RUN: 'not_run',
  VALID_IDENTITY_DOCUMENT: 'valid_identity_document',
  LIKELY_IDENTITY_DOCUMENT: 'likely_identity_document',
  UNSUPPORTED_DOCUMENT: 'unsupported_document',
  NON_DOCUMENT: 'non_document',
  UNREADABLE: 'unreadable',
  UNCERTAIN: 'uncertain',
});

export const EXTRACTION_TRUST_STATUS = Object.freeze({
  NOT_RUN: 'not_run',
  TRUSTED: 'trusted',
  PARTIALLY_TRUSTED: 'partially_trusted',
  UNTRUSTED: 'untrusted',
  NO_FIELDS: 'no_fields',
});

export class DocumentClassifier {
  /**
   * Layer 1 — Deterministic checks.
   * Uses existing evidenceValidation.js but returns richer classification reasons.
   */
  static async deterministicCheck(buffers) {
    const result = validateEvidenceImages(buffers);

    if (!result.valid) {
      const reasons = result.reasons || [];
      let classification = EVIDENCE_CLASSIFICATION.UNCERTAIN;
      let reasonCode = null;

      for (const r of reasons) {
        if (r.includes('too small')) { classification = EVIDENCE_CLASSIFICATION.NON_DOCUMENT; reasonCode = 'DOCUMENT_TOO_SMALL'; break; }
        if (r.includes('not a supported')) { classification = EVIDENCE_CLASSIFICATION.NON_DOCUMENT; reasonCode = 'TECHNICAL_ERROR'; break; }
        if (r.includes('identical')) { classification = EVIDENCE_CLASSIFICATION.NON_DOCUMENT; reasonCode = r.includes('Front and back') ? 'FRONT_BACK_DUPLICATE' : 'SELFIE_DOCUMENT_DUPLICATE'; break; }
      }

      return {
        layer1Passed: false,
        classification,
        reasonCode,
        reasons,
        hashes: result.hashes,
      };
    }

    return {
      layer1Passed: true,
      classification: null,
      reasonCode: null,
      reasons: [],
      hashes: result.hashes,
    };
  }

  /**
   * Layer 2 — constrained vision classification through the GOVERNED PROVIDER BOUNDARY.
   *
   * This asks one question — "is a readable identity document present?" — and nothing else. It
   * does NOT extract personal fields, and its answer is a PROVIDER OBSERVATION, never an identity
   * decision. Approval remains the reviewer's and the identity authority's alone.
   *
   * The provider comes from `resolveVisionProvider()` (CARUP_OCR_PROVIDER, default `cloudflare`
   * running `@cf/qwen/qwen3.8-27b`). There is deliberately NO automatic fallback: an unconfigured
   * or failing provider produces an honest unavailable/error reading attributed to the provider
   * that was actually configured, never a silent switch to another vendor whose output would then
   * carry the wrong provenance.
   *
   * ONE IMAGE PER CALL. The Workers AI vision models accept a single image per request and REFUSE
   * a second rather than silently dropping it, so each side is classified in its own call and the
   * results are combined by the rule below. The front is the document face and governs; the back
   * is genuinely classified and recorded, never discarded, and can only make the combined answer
   * weaker — a back that reads as a non-document downgrades the pair to `uncertain` rather than
   * letting a good front carry an unrelated image through.
   */
  static async classifyDocument(frontBuffer, backBuffer, selfieBuffer, declaredDocType) {
    const systemPrompt = `You are a document presence classifier. Your ONLY task is to determine whether the uploaded image contains a visible identity document.

Rules:
1. Identity documents include: national ID cards, passports, driver's licenses, vehicle registration books.
2. A photograph of a cup, keyboard, desk, wall, person's face, random object, or screenshot is NOT an identity document.
3. A blurry or mostly obscured document should be classified as "unreadable".
4. A document that occupies less than 30% of the image area should be classified as "non_document".
5. If you are unsure, return "uncertain".
6. Do NOT extract names, ID numbers, dates, or any personal fields.

OUTPUT FORMAT — ABSOLUTE. Reply with a single JSON object and nothing else. No prose, no markdown, no code fences:
{
  "classification": "valid_identity_document" | "likely_identity_document" | "unsupported_document" | "non_document" | "unreadable" | "uncertain",
  "classification_confidence": 0.0-1.0,
  "reason": "Brief reason for the classification"
}`;

    // Declared for providers that accept one; Qwen's measured transport suppresses fields when a
    // schema is sent, so the boundary decides per model whether to forward it.
    const jsonSchema = {
      name: 'document_presence',
      schema: {
        type: 'object',
        properties: {
          classification: { type: 'string' },
          classification_confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['classification'],
      },
    };

    let provider;
    try {
      provider = resolveVisionProvider();
    } catch (error) {
      // A misconfigured provider is a configuration fault, not a verdict about the document.
      return {
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        classificationConfidence: 0,
        reason: `Classification provider misconfigured: ${error.message}`,
        provider: String(process.env.CARUP_OCR_PROVIDER || 'unresolved'),
        model: null,
        execution: null,
      };
    }

    const providerModel = (() => { try { return provider.model; } catch { return null; } })();

    if (!provider.isConfigured()) {
      return {
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        classificationConfidence: 0,
        reason: `Classification provider "${provider.id}" is not configured (requires ${provider.requiredEnv.join(', ')}).`,
        provider: provider.id,
        model: providerModel,
        execution: null,
      };
    }

    const sides = [['front', frontBuffer], ['back', backBuffer]].filter(([, buffer]) => buffer);
    if (sides.length === 0) {
      return {
        classification: EVIDENCE_CLASSIFICATION.NON_DOCUMENT,
        classificationConfidence: 1,
        reason: 'No document image was supplied.',
        provider: provider.id,
        model: providerModel,
        execution: null,
      };
    }

    const readings = [];
    try {
      for (const [side, buffer] of sides) {
        const { content, usage } = await provider.extract({
          systemPrompt,
          textPrompt: `Declared document type: ${declaredDocType || 'unknown'}\nThe attached image is the document ${side}.\n\nClassify the attached image for identity document presence.`,
          images: [{ mimeType: sniffImageMime(buffer), base64: buffer.toString('base64') }],
          jsonSchema,
          timeoutMs: 90_000,
        });
        readings.push({ side, ...DocumentClassifier.parseClassification(content), usage: usage || null });
      }
    } catch (error) {
      console.warn('Document classification failed:', error.message);
      return {
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        classificationConfidence: 0,
        reason: `Classification provider error: ${error.message}`,
        provider: provider.id,
        model: providerModel,
        execution: readings.length ? { sides: readings.map(({ side, usage }) => ({ side, usage })) } : null,
      };
    }

    const front = readings.find((reading) => reading.side === 'front') || readings[0];
    const back = readings.find((reading) => reading.side === 'back') || null;

    let classification = front.classification;
    let reason = front.reason;
    if (back && back.classification === EVIDENCE_CLASSIFICATION.NON_DOCUMENT
      && classification !== EVIDENCE_CLASSIFICATION.NON_DOCUMENT) {
      classification = EVIDENCE_CLASSIFICATION.UNCERTAIN;
      reason = `Front read as "${front.classification}" but the back is not a document (${back.reason}).`;
    }

    return {
      classification,
      classificationConfidence: front.classificationConfidence,
      reason,
      provider: provider.id,
      model: providerModel,
      // EXECUTION EVIDENCE, not telemetry: it is how a later reader tells a real reading from a
      // request whose image may never have reached the model.
      execution: {
        sides: readings.map(({ side, classification: sideClass, usage }) => ({ side, classification: sideClass, usage })),
      },
    };
  }

  /**
   * Provider output must be a JSON object carrying one of the known classifications.
   *
   * Nothing is inferred from prose: a string must either parse, or yield ONE balanced JSON object
   * that itself parses to a plain object. Anything else, and any unrecognised classification value,
   * falls closed to `uncertain` — never to a positive class.
   */
  static parseClassification(rawResponse) {
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
        parsed = recovered;
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        classificationConfidence: 0,
        reason: 'The classification provider returned output in an unrecognised shape.',
      };
    }
    const known = Object.values(EVIDENCE_CLASSIFICATION);
    const classification = known.includes(parsed.classification)
      ? parsed.classification
      : EVIDENCE_CLASSIFICATION.UNCERTAIN;
    const confidence = Number(parsed.classification_confidence);
    return {
      classification,
      classificationConfidence: Number.isFinite(confidence) ? confidence : 0.5,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'Classification completed.',
    };
  }

  /**
   * Combined classification: Layer 1 + Layer 2.
   * Returns a unified result with the classification and a decision on whether
   * extraction should proceed.
   */
  static async classify({ front, back, selfie } = {}, declaredDocType) {
    const buffers = { front, back, selfie };

    // Layer 1: deterministic checks
    const layer1 = await DocumentClassifier.deterministicCheck(buffers);

    const hashes = layer1.hashes || {};

    if (!layer1.layer1Passed) {
      return {
        classification: layer1.classification,
        classificationConfidence: 1.0,
        reasonCode: layer1.reasonCode,
        reasons: layer1.reasons,
        hashes,
        extractionAllowed: false,
        extractionTrust: EXTRACTION_TRUST_STATUS.NOT_RUN,
        provider: 'deterministic',
        model: 'layer1-v1',
      };
    }

    // In test mock mode, skip Layer 2 and allow extraction
    const mockAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
    if (mockAllowed) {
      return {
        classification: EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT,
        classificationConfidence: 1.0,
        reasonCode: null,
        reasons: [],
        hashes,
        extractionAllowed: true,
        extractionTrust: EXTRACTION_TRUST_STATUS.PARTIALLY_TRUSTED,
        provider: 'mock',
        model: 'test-mock-v1',
      };
    }

    // Layer 2: vision classification
    const layer2 = await DocumentClassifier.classifyDocument(
      front, back, selfie, declaredDocType
    );

    // Determine if extraction should proceed
    const extractionAllowed = [
      EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT,
      EVIDENCE_CLASSIFICATION.LIKELY_IDENTITY_DOCUMENT,
    ].includes(layer2.classification);

    const extractionTrust = extractionAllowed
      ? EXTRACTION_TRUST_STATUS.PARTIALLY_TRUSTED
      : EXTRACTION_TRUST_STATUS.NOT_RUN;

    const fullReasons = [];
    if (layer2.reason) fullReasons.push(layer2.reason);

    let reasonCode = null;
    if (!extractionAllowed) {
      switch (layer2.classification) {
        case EVIDENCE_CLASSIFICATION.NON_DOCUMENT:
          reasonCode = 'NON_DOCUMENT';
          break;
        case EVIDENCE_CLASSIFICATION.UNSUPPORTED_DOCUMENT:
          reasonCode = 'UNSUPPORTED_DOCUMENT_TYPE';
          break;
        case EVIDENCE_CLASSIFICATION.UNREADABLE:
          reasonCode = 'UNREADABLE_DOCUMENT';
          break;
        default:
          reasonCode = 'DOCUMENT_NOT_VISIBLE';
      }
    }

    return {
      classification: layer2.classification,
      classificationConfidence: layer2.classificationConfidence,
      reasonCode,
      reasons: fullReasons,
      hashes,
      extractionAllowed,
      extractionTrust,
      provider: layer2.provider,
      model: layer2.model,
      execution: layer2.execution || null,
    };
  }

  /**
   * Persist a classification assessment record.
   */
  static async persistClassification(client, sessionId, classificationResult) {
    try {
      const { error } = await client
        .from('verification_assessments')
        .insert({
          session_id: sessionId,
          evidence_classification: classificationResult.classification,
          document_classification_confidence: classificationResult.classificationConfidence,
          ocr_execution_status: classificationResult.extractionAllowed ? 'not_run' : 'not_run',
          extraction_trust_status: classificationResult.extractionTrust,
          evidence_hashes: classificationResult.hashes || null,
          provider: classificationResult.provider,
          provider_model: classificationResult.model,
          risk_level: classificationResult.reasonCode === 'NON_DOCUMENT' ? 'error' : 'warn',
          // Provider EXECUTION EVIDENCE travels with the reading: which transport form carried the
          // image, how many prompt tokens the provider counted, how many image bytes were sent.
          // Without it "the model said non_document" and "the model never saw the image" are the
          // same row — the exact failure the measured Qwen transport exists to prevent.
          risk_flags: (classificationResult.reasons?.length || classificationResult.execution)
            ? {
              ...(classificationResult.reasons?.length ? { reasons: classificationResult.reasons } : {}),
              ...(classificationResult.execution ? { provider_execution: classificationResult.execution } : {}),
            }
            : null,
        });

      if (error) {
        console.warn('Classification persistence failed:', error.message);
      }
    } catch (err) {
      console.warn('Classification persistence error:', err.message);
    }
  }
}
