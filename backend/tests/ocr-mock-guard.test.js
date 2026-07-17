/**
 * P0 guard: mock/seeded OCR identity data must be impossible outside the test
 * suite, and the OCR provider must fail closed (throw) rather than emit a
 * simulated identity when no real provider is available.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { askGemini } = await import('../services/ai/GeminiClient.js');

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('mock OCR is refused outside NODE_ENV=test even if ALLOW_OCR_MOCK=true', () => {
  withEnv({ NODE_ENV: 'production', ALLOW_OCR_MOCK: 'true' }, () => {
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false);
  });
  withEnv({ NODE_ENV: 'development', ALLOW_OCR_MOCK: 'true' }, () => {
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false);
  });
});

test('mock OCR allowed ONLY with NODE_ENV=test AND explicit ALLOW_OCR_MOCK=true', () => {
  withEnv({ NODE_ENV: 'test', ALLOW_OCR_MOCK: 'true' }, () => {
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), true);
  });
  withEnv({ NODE_ENV: 'test', ALLOW_OCR_MOCK: 'false' }, () => {
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false);
  });
  withEnv({ NODE_ENV: 'test', ALLOW_OCR_MOCK: undefined }, () => {
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false);
  });
});

test('askGemini fails closed (throws) when no API key and not in test-mock mode', async () => {
  await withEnv({ GEMINI_API_KEY: undefined, NODE_ENV: 'production', ALLOW_OCR_MOCK: 'true' }, async () => {
    await assert.rejects(() => askGemini('system', 'extract ocr', true), /OCR provider unavailable/);
  });
});
