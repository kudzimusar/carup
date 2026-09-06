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
    if (!response.ok) {
      throw new Error(`Gemini API ${response.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
    }
    // Same list-of-parts reality as the vision path: the first part is not guaranteed to be the
    // text one, and `parts[0].text` throws on a response that is perfectly valid.
    const replyParts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(replyParts)
      ? replyParts.map((part) => part?.text).find((value) => typeof value === 'string' && value.trim() !== '')
      : undefined;
    if (text) return text;
    throw new Error(`Gemini API returned no text part (finishReason: ${data?.candidates?.[0]?.finishReason || 'none'})`);
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
export async function askGeminiVision(systemPrompt, textPrompt, images = [], jsonMode = false) {
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const parts = [{ text: `${systemPrompt}\n\n${textPrompt}` }];
  for (const image of images) {
    if (!image?.base64) continue;
    parts.push({ inline_data: { mime_type: image.mimeType || 'image/jpeg', data: image.base64 } });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined
    })
  });

  const data = await response.json();

  // The provider's OWN words, when it is the provider that failed. The first version threw
  // "Malformed Gemini vision API response" and discarded `data`, so a live run recorded a session
  // that said only "malformed" — no status, no provider message, no finish reason. That is
  // indistinguishable from a bug in this file, and it is what a real identity case was left holding.
  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(`Gemini vision API ${response.status}: ${detail}`);
  }

  // A candidate's `parts` is a LIST, and only some of its entries carry text — a 2.5-series model
  // may put a non-text part first. Reading `parts[0].text` therefore fails on a perfectly good
  // response. Take the first part that actually has text.
  const candidate = data?.candidates?.[0];
  const replyParts = candidate?.content?.parts;
  const text = Array.isArray(replyParts)
    ? replyParts.map((part) => part?.text).find((value) => typeof value === 'string' && value.trim() !== '')
    : undefined;

  if (!text) {
    const finish = candidate?.finishReason || 'no finishReason';
    const blocked = data?.promptFeedback?.blockReason;
    throw new Error(
      `Gemini vision API returned no text part (finishReason: ${finish}`
      + `${blocked ? `, blockReason: ${blocked}` : ''}, parts: ${Array.isArray(replyParts) ? replyParts.length : 'none'})`,
    );
  }
  return text;
}
