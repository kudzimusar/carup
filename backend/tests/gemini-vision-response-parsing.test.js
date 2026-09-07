/**
 * The vision client's response reader — pinned because a live provider run found it broken.
 *
 * A real GMO-8 identity case reached the deployed classifier, the provider answered, and the case
 * was recorded as "Classification provider error: Malformed Gemini vision API response". Two defects
 * in four lines: `parts[0].text` assumes the first part of a multi-part candidate carries the text,
 * which a 2.5-series model does not guarantee; and the thrown error discarded the response, so the
 * session recorded "malformed" with no status, no provider message and no finish reason — a
 * provider outage indistinguishable from a bug in our own parser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-for-parser-only';
const { askGeminiVision } = await import('../services/ai/GeminiClient.js');

const withFetch = async (impl, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
};
const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('a text part that is not first is still read', async () => {
  const out = await withFetch(reply({
    candidates: [{ content: { parts: [{ inlineData: { data: 'x' } }, { text: '{"classification":"valid_identity_document"}' }] } }],
  }), () => askGeminiVision('sys', 'user', [{ mimeType: 'image/png', base64: 'AAAA' }], true));
  assert.equal(out, '{"classification":"valid_identity_document"}');
});

test('an empty-string text part is skipped rather than returned', async () => {
  const out = await withFetch(reply({
    candidates: [{ content: { parts: [{ text: '   ' }, { text: 'the real answer' }] } }],
  }), () => askGeminiVision('sys', 'user', [], true));
  assert.equal(out, 'the real answer');
});

test("a provider HTTP failure surfaces the provider's own message, not 'malformed'", async () => {
  await withFetch(reply({ error: { message: 'Quota exceeded for model' } }, false, 429), async () => {
    await assert.rejects(
      () => askGeminiVision('sys', 'user', [], true),
      (e) => {
        assert.match(e.message, /429/, 'the status must be visible');
        assert.match(e.message, /Quota exceeded for model/, "the provider's message must be visible");
        assert.doesNotMatch(e.message, /Malformed/, 'a provider refusal is not a malformed response');
        return true;
      },
    );
  });
});

test('no text part at all names the finish reason instead of swallowing it', async () => {
  await withFetch(reply({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }],
    promptFeedback: { blockReason: 'SAFETY' },
  }), async () => {
    await assert.rejects(
      () => askGeminiVision('sys', 'user', [], true),
      (e) => {
        assert.match(e.message, /MAX_TOKENS/);
        assert.match(e.message, /SAFETY/);
        return true;
      },
    );
  });
});

test('the images are sent as inline data parts, not as text', async () => {
  let sent = null;
  await withFetch(async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  }, () => askGeminiVision('sys', 'user', [{ mimeType: 'image/png', base64: 'QUJD' }], true));
  const parts = sent.contents[0].parts;
  assert.equal(parts.length, 2, 'prompt text plus one image');
  assert.equal(parts[1].inline_data.mime_type, 'image/png');
  assert.equal(parts[1].inline_data.data, 'QUJD');
});
