import dotenv from 'dotenv';
dotenv.config();

export async function askGemini(systemPrompt, userPrompt, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    // SECURITY (P0): mock provider responses must NEVER run in a real runtime.
    // Seeded/simulated payloads previously leaked into live identity
    // verification. Mock is permitted ONLY under NODE_ENV=test with an explicit
    // flag; otherwise fail closed so the caller records an honest OCR failure.
    const mockAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
    if (!mockAllowed) {
      throw new Error('OCR provider unavailable: Gemini API key missing and mock OCR is only permitted under NODE_ENV=test with ALLOW_OCR_MOCK=true.');
    }
    // Return high-fidelity mock operational intelligence responses matching the prompts
    console.log('Using simulated Gemini reasoning framework... (TEST MODE ONLY)');
    
    if (jsonMode) {
      const lowerPrompt = userPrompt.toLowerCase();
      
      if (lowerPrompt.includes('zimra') || lowerPrompt.includes('logbook') || lowerPrompt.includes('ocr')) {
        return JSON.stringify({
          confidenceScore: 0.94,
          vin: 'VIN74329849204928',
          owner: 'Tendai Moyo',
          engineNumber: '1GD-FTV-892301',
          make: 'Toyota',
          model: 'Hilux',
          year: 2021,
          importSource: 'South Africa',
          dutyPaid: true
        });
      }
      
      if (lowerPrompt.includes('fraud') || lowerPrompt.includes('listing') || lowerPrompt.includes('title')) {
        return JSON.stringify({
          isFraudulent: false,
          riskRating: 'Low',
          reasons: ['VIN exists in national ledger', 'Price is within market standard values', 'Owner verified through OTP'],
          confidence: 0.98
        });
      }

      if (lowerPrompt.includes('risk') || lowerPrompt.includes('insurance') || lowerPrompt.includes('mileage')) {
        return JSON.stringify({
          riskScore: 24.5,
          recommendedPremium: 145.00,
          currency: 'USD',
          factors: [
            { name: 'Odometer integrity verified', impact: 'Positive' },
            { name: 'Service consistency maintained', impact: 'Positive' },
            { name: 'Import ZIMRA duty cleared', impact: 'Positive' }
          ]
        });
      }
      
      // Fallback valid JSON if no matching keyword
      return JSON.stringify({
        success: true,
        simulated: true,
        message: "Simulated JSON payload from CarUp AI Orchestration."
      });
    }
    
    return "This is a simulated high-fidelity response from the CarUp OS AI Orchestration engine.";
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
        generationConfig: jsonMode ? {
          responseMimeType: 'application/json'
        } : undefined
      })
    });

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text;
    }
    throw new Error('Malformed API response');
  } catch (error) {
    console.error('Gemini API call failed, falling back to simulation:', error.message);
    return JSON.stringify({ error: true, message: error.message });
  }
}

/**
 * Vision variant of askGemini: sends the actual image bytes as inline_data
 * parts so the model can SEE the evidence — a text prompt carrying truncated
 * base64 cannot be classified visually. `images` is an array of
 * `{ mimeType, base64 }`. Unlike askGemini, provider failures THROW so the
 * caller can distinguish "provider error" from a model verdict and fail
 * closed on its own terms.
 *
 * The mock gate matches askGemini exactly (NODE_ENV=test + ALLOW_OCR_MOCK)
 * and returns the same generic simulated payload, so test-mode behaviour of
 * callers is identical to the text path.
 */
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

export async function askGeminiVision(systemPrompt, textPrompt, images = [], jsonMode = false, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const mockAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_OCR_MOCK === 'true';
    if (!mockAllowed) {
      throw new Error('Vision provider unavailable: Gemini API key missing and mock is only permitted under NODE_ENV=test with ALLOW_OCR_MOCK=true.');
    }
    if (jsonMode) {
      return JSON.stringify({
        success: true,
        simulated: true,
        message: 'Simulated JSON payload from CarUp AI Orchestration.'
      });
    }
    return 'This is a simulated high-fidelity response from the CarUp OS AI Orchestration engine.';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;
  const parts = [{ text: `${systemPrompt}\n\n${textPrompt}` }];
  for (const image of images) {
    if (!image?.base64) continue;
    parts.push({ inline_data: { mime_type: image.mimeType || 'image/jpeg', data: image.base64 } });
  }

  const generationConfig = { ...(jsonMode ? { responseMimeType: 'application/json' } : {}), ...(options.generationConfig || {}) };

  // A hung provider must not hold a user's upload open indefinitely; without this a stalled
  // call ran for 105 seconds before surfacing as an unexplained "malformed response".
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 90_000;
  const abort = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {})
      }),
      signal: abort,
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`Gemini vision request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Gemini vision request failed: ${error.message}`);
  }

  const data = await response.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) return text;

  // Say WHY there is no text. "Malformed response" hid a MAX_TOKENS finish, a safety block and
  // an HTTP error behind one message, which is unusable for diagnosis and, worse, indistinguishable
  // from a genuinely unreadable document.
  const candidate = data?.candidates?.[0];
  const reason = data?.error?.status || data?.error?.message
    || data?.promptFeedback?.blockReason
    || candidate?.finishReason
    || (response.ok ? 'no text part in the response' : `HTTP ${response.status}`);
  const usage = data?.usageMetadata
    ? ` (tokens: prompt ${data.usageMetadata.promptTokenCount ?? '?'}, candidates ${data.usageMetadata.candidatesTokenCount ?? '?'}, thoughts ${data.usageMetadata.thoughtsTokenCount ?? '?'})`
    : '';

  // A quota refusal must say WHICH quota. "Rate limited" and "you have used your allowance for
  // the day" call for completely different responses, and only the provider knows which it is.
  const quota = (data?.error?.details || [])
    .flatMap((detail) => detail?.violations || [])
    .map((violation) => violation.quotaId || violation.quotaMetric)
    .filter(Boolean);
  const retryAfter = (data?.error?.details || []).find((detail) => detail?.retryDelay)?.retryDelay;
  const quotaDetail = quota.length
    ? ` [quota: ${quota.join(', ')}${retryAfter ? `; provider suggests retrying after ${retryAfter}` : ''}]`
    : '';

  throw new Error(`Gemini vision returned no text: ${reason}${quotaDetail}${usage}`);
}
