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

export async function runOcrParsing(docType, base64Data, userId) {
  if (!userId) {
    // Evidence rows are attribution: outside the test suite the caller must say WHO the
    // extraction belongs to. The route passes the proven session identity.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('OCR parsing requires the authenticated user id it is being run for.');
    }
    userId = 'u1';
  }
  const systemPrompt = `You are the CarUp OS Document OCR Parser Agent. 
  Analyze the uploaded vehicle registration logbook or ZIMRA Form 21. 
  Extract all structured details into a JSON payload with: { confidenceScore: number, vin: string, owner: string, engineNumber: string, make: string, model: string, year: number, importSource: string, dutyPaid: boolean }`;
  
  const userPrompt = `Document Type: ${docType}
  Image Payload Base64: ${base64Data ? base64Data.slice(0, 100) : 'Mock Data'}...`;
  
  const startTime = Date.now();
  const response = await askGemini(systemPrompt, userPrompt, true);
  await logInference('gemini-vision', userPrompt, response, startTime);
  
  const result = JSON.parse(response);
  
  try {
    const id = generateId('ocr');
    await supabase.from('ocr_documents').insert({
      id, user_id: userId, document_type: docType, file_path: base64Data ? 'inline_b64' : 'mock_path', extracted_json: JSON.stringify(result), confidence_score: result.confidenceScore || 0.5, status: 'Pending_Verification', created_at: new Date().toISOString()
    });
    
    result._ocrDocumentId = id;
  } catch (err) {
    console.warn('⚠️ OCR persistence failed (non-fatal):', err.message);
  }
  
  return result;
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
