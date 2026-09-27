import { askGemini } from './GeminiClient.js';
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

export async function runFraudAnalysis(vin, price, listingTitle) {
  const systemPrompt = `You are the CarUp OS Fraud Detection Agent. 
  Analyse the listing detail to check for potential cloned registrations, odometer manipulation risk, pricing standard compliance, or duplicate image risk. 
  Output a JSON object with: { isFraudulent: boolean, riskRating: string, reasons: string[], confidence: number }`;
  
  const userPrompt = `Vehicle VIN: ${vin}
  Price: $${price} USD
  Listing Title: ${listingTitle}`;
  
  const startTime = Date.now();
  const response = await askGemini(systemPrompt, userPrompt, true);
  await logInference('gemini-pro', userPrompt, response, startTime);
  
  const result = JSON.parse(response);
  
  try {
    const id = generateId('fraud');
    const riskRating = result.riskRating || 'Low';
    const normalizedRating = ['Low', 'Medium', 'High', 'Critical'].includes(riskRating) ? riskRating : 'Low';
    
    await supabase.from('ai_fraud_scans').insert({
      id, vin, model_version: 'gemini-pro-v1', risk_score: result.riskScore || 0, risk_rating: normalizedRating, reasons_json: JSON.stringify(result.reasons || []), confidence: result.confidence || 0.5, is_flagged: result.isFraudulent ? true : false, moderation_status: 'None', created_at: new Date().toISOString()
    });
  } catch (err) {
    console.warn('⚠️ Fraud scan persistence failed (non-fatal):', err.message);
  }
  
  return result;
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

export async function runRiskScoring(vin, mileage, basePrice) {
  const systemPrompt = `You are the CarUp OS Risk Analyst Agent.
  Calculate the automotive risk index, dynamic monthly insurance premiums, and future depreciation vectors based on vehicle parameters.
  Output JSON format: { riskScore: number, recommendedPremium: number, currency: string, factors: { name: string, impact: string }[] }`;
  
  const userPrompt = `VIN: ${vin}
  Mileage: ${mileage} km
  Base Price: $${basePrice} USD`;
  
  const startTime = Date.now();
  const response = await askGemini(systemPrompt, userPrompt, true);
  await logInference('gemini-pro', userPrompt, response, startTime);
  
  return JSON.parse(response);
}
