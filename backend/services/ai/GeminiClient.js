import dotenv from 'dotenv';
dotenv.config();

export async function askGemini(systemPrompt, userPrompt, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    if (process.env.ALLOW_OCR_MOCK !== 'true') {
      throw new Error('FATAL: Gemini API key is missing and ALLOW_OCR_MOCK is disabled.');
    }
    // Return high-fidelity mock operational intelligence responses matching the prompts
    console.log('Using simulated Gemini reasoning framework...');
    
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
