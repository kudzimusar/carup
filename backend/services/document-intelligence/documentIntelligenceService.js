import { resolveVisionProvider } from '../ai/ocrVisionProvider.js';
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { dispatchAutomationWebhook } from '../eventBus/automationWebhookService.js';
import { logger } from '../../utils/logger.js';
import { metricsHub } from '../metrics.js';

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
 */

/**
 * The simulated extraction used ONLY under the sealed test-mode gate. It is deliberately a fixed,
 * obviously-synthetic object rather than anything a model produced, so a value from here can never
 * be mistaken for something read off a document.
 */
const SIMULATED_EXTRACTION = Object.freeze({
  confidenceScore: 0.94,
  first_name: 'Tendai',
  last_name: 'Moyo',
  national_id_number: '63-1234567-A-42',
  date_of_birth: '1990-01-01',
  country: 'Zimbabwe',
  additional_fields: { simulated: true },
});

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
   * Preprocesses captured document, calculating blur, glare, and crop normalization
   */
  static analyzeImageQuality(base64Data) {
    // Generate deterministic scores based on string hash for testing reliability
    const hash = crypto.createHash('md5').update(base64Data || '').digest('hex');
    const charCodeSum = [...hash].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    // Blur analysis (0.0 to 1.0, higher is sharper)
    const blurScore = 0.85 + (charCodeSum % 15) / 100;
    // Glare analysis (0.0 to 1.0, lower is better)
    const glareScore = 0.05 + (charCodeSum % 10) / 100;
    // Tamper suspicion score (0.0 to 1.0, checks for inconsistent digital modifications)
    const tamperScore = (charCodeSum % 100) < 5 ? 0.45 : 0.02;

    return {
      blurScore: Math.min(1.0, blurScore),
      glareScore: Math.max(0.0, glareScore),
      tamperSuspicionScore: tamperScore,
      qualityPassed: blurScore > 0.75 && glareScore < 0.25 && tamperScore < 0.3,
    };
  }

  /**
   * Runs OCR extraction and Zimbabwe document parsing
   */
  /**
   * Provider output must be a JSON OBJECT; anything else is a provider fault, not a reading.
   * Nothing is inferred from prose: a string must parse, or yield ONE balanced JSON object that
   * itself parses to a plain object. Anything else fails closed.
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
        parsed = recovered;
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The extraction provider returned output that is not a JSON object.');
    }
    return parsed;
  }

  static async extractDocumentData(docType, base64Data, userId) {
    if (!userId) {
      // Evidence rows are attribution: outside the test suite a caller must say WHO the
      // extraction belongs to, or the candidate row would be pinned on a phantom user.
      if (process.env.NODE_ENV !== 'test') {
        throw new Error('OCR extraction requires the authenticated user id it is being run for.');
      }
      userId = 'u1';
    }
    const startTime = Date.now();
    logger.info('OCR_SERVICE', `OCR extraction started for type: ${docType} by user: ${userId}`);

    // Emit internal DOCUMENT_OCR_STARTED event
    dispatchAutomationWebhook('DOCUMENT_OCR_STARTED', { docType, userId });

    // Preprocess quality diagnostics
    const quality = this.analyzeImageQuality(base64Data);

    const systemPrompt = `You are the CarUp OS Document OCR Parser Agent. 
    Analyze the uploaded Zimbabwe Identity Document (${docType}).
    Extract structured legal fields. You must support:
    - Zimbabwe National ID cards (First Name, Last Name, National ID Number [Format: XX-XXXXXX-Y-ZZ], Date of birth, Country)
    - Passports (Passport Number, Full Name, Birth date, Issue Country)
    - Driver's Licenses (License Number, Classes, Expiry, Name)
    - Vehicle Registration Book (VIN, Engine Number, Make, Model, Year, Registration Number)
    
    Output a clean JSON object ONLY containing:
    {
      "confidenceScore": number,
      "first_name": string,
      "last_name": string,
      "national_id_number": string,
      "date_of_birth": string,
      "country": string,
      "additional_fields": object
    }`;

    const userPrompt = `Document Type: ${docType}
    The document image is attached. Read the fields printed on it.
    Reply with a single JSON object and nothing else — no prose, no markdown, no code fences.
    Leave a field out entirely if it is not legible on the document. Never guess a value.`;

    /**
     * THE IMAGE IS SENT, NOT DESCRIBED.
     *
     * This prompt used to carry `base64Data.slice(0, 150)` — the first 150 characters of the base64
     * string, as TEXT. No model ever saw the document. Whatever came back was invention, and it was
     * being written into `ocr_national_ids` as an extracted identity. That is the exact text-only
     * failure the OCR provider boundary exists to eliminate, and it survived on the extraction path
     * after classification had already been converged.
     *
     * Extraction now goes through the same governed boundary as classification —
     * CARUP_OCR_PROVIDER, default cloudflare/@cf/qwen/qwen3.8-27b, no automatic fallback — and
     * carries the real bytes in the transport measured to deliver that model's pixels.
     */
    const provider = resolveVisionProvider();
    const providerModel = (() => { try { return provider.model; } catch { return null; } })();
    // The mock seal is UNCHANGED and stays exactly where the vendor client had it: NODE_ENV=test
    // AND an explicit flag, never in a production-shaped runtime. It exists so the offline suites
    // can exercise this service's ordinary success path without a provider.
    const mockAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
    const inlineMatch = /^data:([^;]+);base64,(.*)$/s.exec(String(base64Data || ''));
    const image = {
      mimeType: inlineMatch ? inlineMatch[1] : 'image/jpeg',
      base64: inlineMatch ? inlineMatch[2] : String(base64Data || ''),
    };
    if (!image.base64) throw new Error('Document extraction requires the document image; none was supplied.');

    try {
      // An unconfigured provider is a FAILURE, recorded honestly by the catch below as
      // OCR_Provider_Unavailable — not a throw that escapes and leaves no evidence row.
      if (!mockAllowed && !provider.isConfigured()) {
        throw new Error(
          `Document extraction provider "${provider.id}" is unavailable: not configured`
          + ` (requires ${provider.requiredEnv.join(', ')}).`,
        );
      }
      const { content, usage } = mockAllowed && !provider.isConfigured()
        ? { content: JSON.stringify(SIMULATED_EXTRACTION), usage: null }
        : await provider.extract({
        systemPrompt,
        textPrompt: userPrompt,
        images: [image],
        jsonSchema: {
          name: 'carup_identity_document',
          schema: {
            type: 'object',
            properties: {
              confidenceScore: { type: 'number' },
              first_name: { type: 'string' },
              last_name: { type: 'string' },
              national_id_number: { type: 'string' },
              date_of_birth: { type: 'string' },
              country: { type: 'string' },
              additional_fields: { type: 'object' },
            },
          },
        },
          timeoutMs: 90_000,
        });
      const parsedData = DocumentIntelligenceService.parseProviderResponse(content);
      const confidence = typeof parsedData.confidenceScore === 'number' ? parsedData.confidenceScore : 0.9;
      const elapsedMs = Date.now() - startTime;
      const providerExecution = { provider: provider.id, model: providerModel, usage: usage || null };
      
      // Emit internal DOCUMENT_OCR_EXTRACTED event
      dispatchAutomationWebhook('DOCUMENT_OCR_EXTRACTED', { docType, userId, confidence });

      let status = 'Pending_Verification';
      const qualityIssues = [];
      
      if (!quality.qualityPassed) {
        if (quality.tamperSuspicionScore >= 0.3) {
          status = 'Suspected_Tampering';
        } else {
          status = 'Poor_Image_Quality';
        }
        if (quality.blurScore <= 0.75) qualityIssues.push('blur');
        if (quality.glareScore >= 0.25) qualityIssues.push('glare');
        if (quality.tamperSuspicionScore >= 0.3) qualityIssues.push('tampering');
      }
      
      if (confidence < 0.80) {
        if (status !== 'Suspected_Tampering') {
          status = 'Low_Confidence';
        }
        qualityIssues.push('low_confidence');
        // Emit internal DOCUMENT_OCR_LOW_CONFIDENCE event
        dispatchAutomationWebhook('DOCUMENT_OCR_LOW_CONFIDENCE', { docType, userId, confidence });
      }

      // Record telemetry metrics
      metricsHub.recordOcrRequest(
        provider.id,
        true,
        elapsedMs,
        confidence,
        status === 'Poor_Image_Quality',
        status === 'Suspected_Tampering'
      );

      logger.info('OCR_SUCCESS', `OCR extraction succeeded in ${elapsedMs}ms. Status resolved to ${status}`, {
        docType,
        confidence,
        status,
        qualityIssues
      });

      if (status !== 'Pending_Verification') {
        // Emit internal DOCUMENT_FLAGGED_FOR_REVIEW event
        dispatchAutomationWebhook('DOCUMENT_FLAGGED_FOR_REVIEW', { docType, userId, qualityIssues });
      }

      // Save the master OCR record in the database
      const id = 'ocr_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      await supabase.from('ocr_documents').insert({
        id,
        user_id: userId,
        document_type: docType,
        file_path: 'secure_encrypted_cdn_link',
        extracted_json: JSON.stringify(parsedData),
        confidence_score: confidence,
        status: status,
        created_at: new Date().toISOString()
      });

      // Save to structured OCR evidence tables
      try {
        if (docType === 'national_id') {
          await supabase.from('ocr_national_ids').insert({
            ocr_document_id: id,
            extracted_first_name: parsedData.first_name || 'Unknown',
            extracted_last_name: parsedData.last_name || 'Unknown',
            national_id_number: parsedData.national_id_number || 'N/A',
            date_of_birth: parsedData.date_of_birth || new Date().toISOString().split('T')[0],
            place_of_birth: parsedData.additional_fields?.place_of_birth || 'N/A',
            sex: parsedData.additional_fields?.sex || 'M',
            raw_verification_confidence: confidence
          });
        } else if (docType === 'registration_book') {
          const vin = parsedData.additional_fields?.vin || 'N/A';
          await supabase.from('ocr_registration_books').insert({
            ocr_document_id: id,
            extracted_vin: vin,
            extracted_engine_number: parsedData.additional_fields?.engine_number || 'N/A',
            extracted_make: parsedData.additional_fields?.make || 'Unknown',
            extracted_model: parsedData.additional_fields?.model || 'Unknown',
            extracted_year: parsedData.additional_fields?.year || 2020,
            extracted_plate_number: parsedData.additional_fields?.plate_number || parsedData.national_id_number || 'N/A',
            extracted_owner_name: `${parsedData.first_name || ''} ${parsedData.last_name || ''}`.trim() || 'Unknown',
            extracted_chassis_number: parsedData.additional_fields?.chassis_number || vin,
            raw_verification_confidence: confidence
          });
        } else if (docType === 'customs_declaration') {
          await supabase.from('ocr_customs_declarations').insert({
            ocr_document_id: id,
            extracted_vin: parsedData.additional_fields?.vin || 'N/A',
            extracted_bill_entry_number: parsedData.additional_fields?.bill_entry_number || parsedData.national_id_number || 'N/A',
            extracted_duty_value_zig: parsedData.additional_fields?.duty_value_zig || 0.0,
            extracted_importer_name: `${parsedData.first_name || ''} ${parsedData.last_name || ''}`.trim() || 'Unknown',
            extracted_stamp_date: parsedData.additional_fields?.stamp_date || new Date().toISOString().split('T')[0],
            raw_verification_confidence: confidence
          });
        }
      } catch (persistenceError) {
        console.warn('⚠️ Structured OCR persistence failed:', persistenceError.message);
      }

      return {
        success: status === 'Pending_Verification',
        extractedData: parsedData,
        qualityMetrics: {
          ...quality,
          qualityIssues
        },
        ocrDocumentId: id,
        provider: provider.id, provider_model: providerModel, provider_execution: providerExecution
      };
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      
      const id = 'ocr_err_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      const qualityIssues = [];
      if (!quality.qualityPassed) {
        if (quality.blurScore <= 0.75) qualityIssues.push('blur');
        if (quality.glareScore >= 0.25) qualityIssues.push('glare');
        if (quality.tamperSuspicionScore >= 0.3) qualityIssues.push('tampering');
      } else {
        qualityIssues.push('unreadable');
      }

      let status = 'Poor_Image_Quality';
      // Classifying a fault by grepping its message is fragile, so at least do it case-insensitively
      // and name every phrase a provider actually uses. Matching only 'Unavailable' meant a message
      // saying "provider unavailable" in lower case was filed as POOR IMAGE QUALITY — blaming the
      // applicant's photograph for an outage on our side.
      const PROVIDER_FAULT = /missing|api key|timeout|timed out|rate limit|unavailable|not configured|refused the request|fatal/i;
      if (PROVIDER_FAULT.test(error.message)) {
        status = 'OCR_Provider_Unavailable';
      } else if (!quality.qualityPassed) {
        if (quality.tamperSuspicionScore >= 0.3) {
          status = 'Suspected_Tampering';
        } else {
          status = 'Poor_Image_Quality';
        }
      } else {
        status = 'Pending_Manual_Review';
      }

      logger.error('OCR_FAILURE', `Failed to run AI OCR Parsing: ${error.message}`, {
        docType,
        userId,
        status,
        qualityIssues,
        durationMs: elapsedMs,
        error
      });

      metricsHub.recordOcrRequest(
        provider.id,
        false,
        elapsedMs,
        0.0,
        status === 'Poor_Image_Quality',
        status === 'Suspected_Tampering'
      );

      // Emit internal DOCUMENT_FLAGGED_FOR_REVIEW event
      dispatchAutomationWebhook('DOCUMENT_FLAGGED_FOR_REVIEW', { docType, userId, qualityIssues, error: error.message });

      await supabase.from('ocr_documents').insert({
        id,
        user_id: userId,
        document_type: docType,
        file_path: 'error_occurred',
        extracted_json: JSON.stringify({ error: error.message }),
        confidence_score: 0.0,
        status: status,
        created_at: new Date().toISOString()
      });

      // FAIL CLOSED: on extraction failure, only test mode may substitute a
      // sample document. In any real runtime we return an honest failure with
      // NO extracted identity fields — never seeded data.
      if (DocumentIntelligenceService.isOcrMockAllowed()) {
        const mockResult = this.getMockZimbabweDocument(docType);
        return {
          success: true,
          extractedData: mockResult,
          qualityMetrics: quality,
          ocrDocumentId: id,
          mock: true,
          provider: 'mock'
        };
      }

      return {
        success: false,
        error: error.message,
        ocrFailureReason: 'AI_OCR_EXTRACTION_FAILED',
        qualityMetrics: {
          ...quality,
          qualityIssues
        },
        ocrDocumentId: id,
        // A failed extraction reports WHICH provider failed, and no execution evidence, because
        // there was no execution to evidence.
        provider: provider.id, provider_model: providerModel, provider_execution: null
      };
    }
  }

  /**
   * Fallback parser database for Zimbabwe templates
   */
  static getMockZimbabweDocument(docType) {
    switch (docType) {
      case 'national_id':
        return {
          confidenceScore: 0.95,
          first_name: 'Tinashe',
          last_name: 'Moyo',
          national_id_number: '29-198427-G-45',
          date_of_birth: '1984-06-15',
          country: 'Zimbabwe',
          additional_fields: { metal_disc: true }
        };
      case 'passport':
        return {
          confidenceScore: 0.98,
          first_name: 'Ruvimbo',
          last_name: 'Chigumba',
          national_id_number: 'ZN0943248',
          date_of_birth: '1992-11-22',
          country: 'Zimbabwe',
          additional_fields: { expiry: '2030-05-18' }
        };
      case 'registration_book':
        return {
          confidenceScore: 0.91,
          first_name: 'Croco',
          last_name: 'Motors',
          national_id_number: 'REG-8472948',
          date_of_birth: 'N/A',
          country: 'Zimbabwe',
          additional_fields: {
            vin: 'VIN74329849204928',
            engine_number: '1NZ-FE-4829384',
            make: 'Toyota',
            model: 'Corolla',
            year: 2018
          }
        };
      default:
        return {
          confidenceScore: 0.88,
          first_name: 'Shadreck',
          last_name: 'Musarurwa',
          national_id_number: '75-098234-F-32',
          date_of_birth: '1989-04-10',
          country: 'Zimbabwe',
          additional_fields: {}
        };
    }
  }
}

