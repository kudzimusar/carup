export class CommunicationGeminiProvider {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.COMMUNICATION_AI_MODEL || 'gemini-2.5-flash',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.provider = 'google';
  }

  health() {
    return {
      provider: this.provider,
      model: this.model,
      available: Boolean(this.apiKey && this.fetchImpl),
      mode: 'real',
      multimodal: true,
    };
  }

  async generate({ systemPrompt, userPrompt, media = [] } = {}) {
    if (!this.apiKey || !this.fetchImpl) {
      const error = new Error('Communications AI provider is not configured.');
      error.statusCode = 503;
      error.code = 'communication_ai_provider_unavailable';
      throw error;
    }
    const parts = [{ text: `${systemPrompt || ''}\n\n${userPrompt || ''}` }];
    for (const item of Array.isArray(media) ? media : []) {
      if (!item?.mimeType || !item?.dataBase64) continue;
      parts.push({ inlineData: { mimeType: item.mimeType, data: item.dataBase64 } });
    }
    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.2 },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Communications AI provider returned HTTP ${response.status}.`);
      error.statusCode = 502;
      error.code = 'communication_ai_provider_error';
      throw error;
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim();
    if (!text) {
      const error = new Error('Communications AI provider returned no usable text.');
      error.statusCode = 502;
      error.code = 'communication_ai_empty_response';
      throw error;
    }
    return { text, provider: this.provider, model: this.model };
  }
}
