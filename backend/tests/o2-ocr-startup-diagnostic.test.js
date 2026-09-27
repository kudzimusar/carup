/**
 * O2 OCR convergence — startup OCR diagnostic truth + mock-reachability rule (bounded).
 *
 * The server boot diagnostic used to describe OCR through retired conventions
 * (OCR_PRIMARY_PROVIDER / OCR_FALLBACK_PROVIDER / OCR_MODE) and printed "OCR provider initialized:
 * None", "Loose OCR mode enabled", "Mock OCR enabled" — none of which describe the current
 * Document Intelligence provider boundary. Operational logs must describe the ACTUAL boundary:
 * CARUP_OCR_PROVIDER / CARUP_OCR_MODEL, resolveVisionProvider(), and whether a mock execution is
 * genuinely reachable (isOcrMockAllowed()). This suite pins the corrected diagnostic and proves the
 * mock rule is unchanged — never printed as reachable when it is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');

test('isOcrMockAllowed is reachable ONLY under NODE_ENV=test AND ALLOW_OCR_MOCK=true', () => {
  const savedEnv = process.env.NODE_ENV;
  const savedMock = process.env.ALLOW_OCR_MOCK;
  try {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_OCR_MOCK = 'true';
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), true, 'test + flag → reachable');

    process.env.NODE_ENV = 'test'; delete process.env.ALLOW_OCR_MOCK;
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false, 'flag unset → NOT reachable');

    process.env.NODE_ENV = 'test'; process.env.ALLOW_OCR_MOCK = 'false';
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false, 'flag false → NOT reachable');

    process.env.NODE_ENV = 'production'; process.env.ALLOW_OCR_MOCK = 'true';
    assert.equal(DocumentIntelligenceService.isOcrMockAllowed(), false, 'production + flag → NOT reachable');
  } finally {
    process.env.NODE_ENV = savedEnv;
    if (savedMock === undefined) delete process.env.ALLOW_OCR_MOCK; else process.env.ALLOW_OCR_MOCK = savedMock;
  }
});

test('SOURCE: the boot diagnostic describes the current provider boundary, not retired env conventions', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
  // The corrected diagnostic uses the canonical helpers.
  assert.match(src, /resolveVisionProvider\(\)/, 'diagnostic must resolve the actual selected provider');
  assert.match(src, /DocumentIntelligenceService\.isOcrMockAllowed\(\)/, 'diagnostic must read the real mock-reachability rule');
  assert.match(src, /OCR provider selected:/, 'diagnostic must report the selected provider');
  assert.match(src, /OCR model selected:/, 'diagnostic must report the selected model');
  assert.match(src, /OCR provider configured:/, 'diagnostic must report configured yes/no');
  assert.match(src, /OCR mock runtime allowed:/, 'diagnostic must report mock reachability yes/no');
  // The retired diagnostic strings must be gone.
  assert.doesNotMatch(src, /OCR provider initialized:/, 'retired "OCR provider initialized" message must be removed');
  assert.doesNotMatch(src, /OCR fallback provider initialized:/, 'retired fallback-provider message must be removed');
  assert.doesNotMatch(src, /Loose OCR mode enabled/, 'retired "Loose OCR mode" message must be removed');
  assert.doesNotMatch(src, /Mock OCR (enabled|disabled)/, 'retired "Mock OCR enabled/disabled" message must be removed');
});

test('SOURCE: /api/health exposes the canonical OCR runtime projection derived from resolveVisionProvider', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
  // The health handler must project the SELECTED provider/model/configured/mock from the canonical
  // resolver, and add a truthful ocrProviders.cloudflare, so "is OCR available" is authoritative.
  assert.match(src, /selectedProvider:\s*provider\.id/, 'health must project the selected provider id');
  assert.match(src, /selectedModel:\s*model/, 'health must project the selected model');
  assert.match(src, /isOcrMockAllowed\(\)/, 'health must project the real mock-reachability rule');
  assert.match(src, /isCloudflareVisionConfigured\(\)/, 'health must derive cloudflare configured truthfully');
  assert.match(src, /ocr,/, 'health response must include the canonical ocr projection object');
  assert.match(src, /cloudflare:\s*cloudflareConfigured/, 'ocrProviders must carry a truthful cloudflare member');
});
