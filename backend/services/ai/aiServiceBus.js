import { askGeminiWithProvenance, AiProviderError, GEMINI_TEXT_MODEL } from './GeminiClient.js';
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';

function generateId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
}

async function logInference(modelName, prompt, output, startTime) {
  try {
    const latencyMs = Date.now() - startTime;
    const id = generateId('inf');
    await supabase.from('ai_inference_logs').insert({
      id, model_name: modelName, prompt_tokens: Math.floor(prompt.length / 4), completion_tokens: Math.floor(output.length / 4), latency_ms: latencyMs, prompt, output, hallucination_flag: false, timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.warn('⚠️ AI telemetry logging failed (non-fatal):', err.message);
  }
}

const FRAUD_RATINGS = ['Low', 'Medium', 'High', 'Critical'];

/**
 * The one answer a fraud or risk route gives when no verdict exists (OC-3B).
 *
 * A provider failure or an unusable reply is "unknown — a human must look", never the most
 * favorable value a default can reach. Before OC-3B a Gemini outage became `riskRating: 'Low'`,
 * `is_flagged: false`, persisted, and a 200.
 */
export function aiProviderUnavailableResponse(error, kind) {
  return {
    error: kind === 'risk_assessment'
      ? 'AI risk assessment is unavailable. No risk figure was produced.'
      : 'AI fraud analysis is unavailable. No verdict was produced; the listing requires manual review.',
    code: error?.code || 'AI_PROVIDER_FAILED',
    outcome: 'unavailable',
    verdict: 'unknown',
    manual_review_required: true,
    provider: error?.provider || 'gemini',
    model: error?.model || GEMINI_TEXT_MODEL,
    retryable: Boolean(error?.retryable),
    persisted: false,
  };
}

function parseModelJson(reply, what) {
  try {
    return JSON.parse(reply.text);
  } catch (cause) {
    throw new AiProviderError(`${what}: the model reply was not valid JSON`, {
      code: 'AI_PROVIDER_INVALID_OUTPUT', provider: reply.provider, model: reply.model, retryable: false, cause,
    });
  }
}

export async function runFraudAnalysis(vin, price, listingTitle) {
  const systemPrompt = `You are the CarUp OS Fraud Detection Agent. 
  Analyse the listing detail to check for potential cloned registrations, odometer manipulation risk, pricing standard compliance, or duplicate image risk. 
  Output a JSON object with: { isFraudulent: boolean, riskRating: string, reasons: string[], confidence: number }`;
  
  const userPrompt = `Vehicle VIN: ${vin}
  Price: $${price} USD
  Listing Title: ${listingTitle}`;
  
  const startTime = Date.now();
  // Throws AiProviderError on any provider failure — there is no envelope to misread any more.
  const reply = await askGeminiWithProvenance(systemPrompt, userPrompt, true);
  await logInference(reply.model, userPrompt, reply.text, startTime);

  const result = parseModelJson(reply, 'fraud analysis');
  // A reply without a recognised rating AND an explicit boolean is not a verdict. It used to default
  // to 'Low' / not flagged — the most favorable answer, reached by absence.
  if (!result || Array.isArray(result) || !FRAUD_RATINGS.includes(result.riskRating) || typeof result.isFraudulent !== 'boolean') {
    throw new AiProviderError('fraud analysis: the model reply carried no recognised verdict', {
      code: 'AI_PROVIDER_INVALID_OUTPUT', provider: reply.provider, model: reply.model, retryable: false,
    });
  }

  const answer = {
    outcome: reply.execution === 'provider_executed' ? 'completed' : 'simulated',
    isFraudulent: result.isFraudulent,
    riskRating: result.riskRating,
    reasons: Array.isArray(result.reasons) ? result.reasons.map(String) : [],
    confidence: typeof result.confidence === 'number' ? result.confidence : null,
    // A generic language model read a VIN, a price and a title. It is a prompt for review, not a
    // finding: it consulted no registry, ledger or image.
    advisory: true,
    provider: reply.provider,
    model: reply.model,
    execution: reply.execution,
    persisted: false,
  };

  // A simulation is not a fraud scan and is never recorded as one.
  if (reply.execution !== 'provider_executed') return answer;

  try {
    const id = generateId('fraud');
    await supabase.from('ai_fraud_scans').insert({
      id, vin, model_version: reply.model, risk_score: typeof result.riskScore === 'number' ? result.riskScore : 0, risk_rating: result.riskRating, reasons_json: JSON.stringify(answer.reasons), confidence: answer.confidence ?? 0, is_flagged: result.isFraudulent === true, moderation_status: 'None', created_at: new Date().toISOString()
    });
    answer.persisted = true;
  } catch (err) {
    console.warn('⚠️ Fraud scan persistence failed (non-fatal):', err.message);
  }
  
  return answer;
}

/**
 * RETIRED OCR COMPATIBILITY SYMBOL.
 *
 * The historical implementation behind this export sent only a truncated Base64 prefix to a
 * text-only Gemini request and substituted confidence. Keeping that implementation anywhere in
 * the runtime means a future route-order or import regression can silently re-open a second OCR
 * truth path. The symbol remains exported only so older imports fail closed with an explicit 410
 * instead of crashing the process at module load.
 *
 * All document OCR must go through DocumentIntelligenceService and its governed provider boundary.
 */
export async function runOcrParsing() {
  const error = new Error(
    'The legacy generic OCR parser is retired. Use the governed identity, dealer, diaspora run-ocr, or vehicle-evidence OCR workflow.'
  );
  error.name = 'LegacyOcrPathRetiredError';
  error.statusCode = 410;
  error.code = 'LEGACY_OCR_PATH_RETIRED';
  throw error;
}

/**
 * Advisory risk index from a generic language model (OC-3B).
 *
 * It used to also return a `recommendedPremium` + `currency`: a monthly insurance premium invented by
 * a text model that consulted no claims history, no underwriting model and no insurer. No web
 * surface renders it (the I10 risk page removed the calculator), and CarUp has no onboarded insurer,
 * so the figure is REMOVED rather than relabelled — it is not asked for and, if a model volunteers
 * one, it is not passed on. What remains is labelled for what it is.
 */
export async function runRiskScoring(vin, mileage, basePrice) {
  const systemPrompt = `You are the CarUp OS Risk Analyst Agent.
  Estimate an advisory automotive risk index (0-100) from the vehicle parameters and list the factors behind it.
  Do not quote, estimate or recommend any insurance premium or price.
  Output JSON format: { riskScore: number, factors: { name: string, impact: string }[] }`;
  
  const userPrompt = `VIN: ${vin}
  Mileage: ${mileage} km
  Base Price: $${basePrice} USD`;
  
  const startTime = Date.now();
  const reply = await askGeminiWithProvenance(systemPrompt, userPrompt, true);
  await logInference(reply.model, userPrompt, reply.text, startTime);

  const result = parseModelJson(reply, 'risk assessment');
  const riskScore = Number(result?.riskScore);
  if (!result || Array.isArray(result) || result.riskScore === null || result.riskScore === undefined || !Number.isFinite(riskScore)) {
    throw new AiProviderError('risk assessment: the model reply carried no numeric risk index', {
      code: 'AI_PROVIDER_INVALID_OUTPUT', provider: reply.provider, model: reply.model, retryable: false,
    });
  }

  // Allow-listed: whatever else the model returned (a premium, a currency, a "discount") stays here.
  return {
    outcome: reply.execution === 'provider_executed' ? 'completed' : 'simulated',
    riskScore,
    factors: Array.isArray(result.factors)
      ? result.factors.filter((f) => f && typeof f === 'object').map((f) => ({ name: String(f.name ?? ''), impact: String(f.impact ?? '') }))
      : [],
    advisory: true,
    binding: false,
    not_an_insurance_quote: true,
    source: 'generic_llm',
    provider: reply.provider,
    model: reply.model,
    execution: reply.execution,
  };
}
