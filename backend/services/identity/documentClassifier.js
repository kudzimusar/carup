/**
 * Phase 7C — Document classification service.
 *
 * Two-pass strategy:
 *   Pass 1: Deterministic checks (MIME, size, entropy, hashes)
 *   Pass 2: Constrained vision classification (is this an identity document?)
 *   Pass 3: Extraction only if Pass 2 qualifies
 *
 * Hallucinated identity fields from non-documents are NEVER persisted as
 * applicant-facing data.
 */

import crypto from 'crypto';
import { validateEvidenceImages } from './evidenceValidation.js';
import { askGemini, askGeminiVision } from '../ai/GeminiClient.js';
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
   * Layer 2 — Constrained vision classification via Gemini.
   *
   * This call ONLY determines whether the image contains a visible identity
   * document. It does NOT extract personal fields. The prompt is designed to
   * return a strict enum value and nothing more.
   */
  static async classifyDocument(frontBuffer, backBuffer, selfieBuffer, declaredDocType) {
    const systemPrompt = `You are a document presence classifier. Your ONLY task is to determine whether the uploaded image(s) contain a visible identity document.

Rules:
1. Identity documents include: national ID cards, passports, driver's licenses, vehicle registration books.
2. A photograph of a cup, keyboard, desk, wall, person's face, random object, or screenshot is NOT an identity document.
3. A blurry or mostly obscured document should be classified as "unreadable".
4. A document that occupies less than 30% of the image area should be classified as "non_document".
5. If you are unsure, return "uncertain".
6. Do NOT extract names, ID numbers, dates, or any personal fields.

Respond with a JSON object ONLY:
{
  "classification": "valid_identity_document" | "likely_identity_document" | "unsupported_document" | "non_document" | "unreadable" | "uncertain",
  "classification_confidence": 0.0-1.0,
  "reason": "Brief reason for the classification"
}`;

    // Send the REAL image bytes as vision parts — a text prompt carrying
    // truncated base64 cannot be classified visually, which blocked every
    // valid document at the pre-OCR gate in production. The selfie is
    // intentionally excluded: it must never influence document presence.
    const images = [];
    if (frontBuffer) images.push({ mimeType: sniffImageMime(frontBuffer), base64: frontBuffer.toString('base64') });
    if (backBuffer) images.push({ mimeType: sniffImageMime(backBuffer), base64: backBuffer.toString('base64') });

    const userPrompt = `Declared document type: ${declaredDocType || 'unknown'}
The attached image(s) are the document front${backBuffer ? ' and back' : ''}.

Classify the FIRST attached image for identity document presence.`;

    try {
      const mockAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey && !mockAllowed) {
        return {
          classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
          classificationConfidence: 0,
          reason: 'Classification provider unavailable.',
          provider: 'unavailable',
          model: null,
        };
      }

      const response = await askGeminiVision(systemPrompt, userPrompt, images, true);

      let parsed;
      if (typeof response === 'string') {
        parsed = JSON.parse(response);
      } else {
        parsed = response;
      }

      const validClassifications = Object.values(EVIDENCE_CLASSIFICATION);
      const classification = validClassifications.includes(parsed.classification)
        ? parsed.classification
        : EVIDENCE_CLASSIFICATION.UNCERTAIN;

      return {
        classification,
        classificationConfidence: parsed.classification_confidence || 0.5,
        reason: parsed.reason || 'Classification completed.',
        provider: 'gemini',
        model: 'gemini-classifier-v1',
      };
    } catch (error) {
      console.warn('Document classification failed:', error.message);
      return {
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        classificationConfidence: 0,
        reason: `Classification provider error: ${error.message}`,
        provider: 'gemini',
        model: null,
      };
    }
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
          risk_flags: classificationResult.reasons ? { reasons: classificationResult.reasons } : null,
        });

      if (error) {
        console.warn('Classification persistence failed:', error.message);
      }
    } catch (err) {
      console.warn('Classification persistence error:', err.message);
    }
  }
}
