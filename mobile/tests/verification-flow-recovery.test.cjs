// Exercises the actual API flow with synthetic network/auth fixtures, not a device or database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'carup-idv-flow-'));
for (const file of ['utils/apiBase.ts', 'utils/verificationApi.ts']) {
  const out = path.join(temp, file.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
}
fs.mkdirSync(path.join(temp, 'store'));
fs.writeFileSync(path.join(temp, 'store/authStore.js'), "exports.useAuthStore={getState:()=>({token:'fixture-token',user:{id:'fixture',role:'owner'}})};\n");
process.env.EXPO_PUBLIC_API_URL = 'https://example.invalid';
const api = require(path.join(temp, 'utils/verificationApi.js'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('new session and app restart recover server case without duplicating submission', async () => {
  const id = '12345678-1234-4234-8234-123456789012';
  let existing = null, sentId = false;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push([url, method, options.headers]);
    if (url.endsWith('/csrf-token')) return { ok: true, json: async () => ({ csrfToken: 'fixture-csrf' }) };
    if (url.endsWith('/latest')) return { ok: true, json: async () => ({ session: existing }) };
    if (url.endsWith('/verification-sessions') && method === 'POST') {
      existing = { id, document_type: 'passport', double_sided: false, status: 'draft', uploaded_sides: { front: false, back: false, selfie: false }, ocr_result: null };
      return { ok: true, json: async () => ({ session: { ...existing } }) };
    }
    if (url.includes('/upload/')) {
      assert.equal(sentId, true); existing.uploaded_sides[url.split('/').pop()] = true; existing.status = 'uploaded';
      return { ok: true, json: async () => ({ session: { ...existing, uploaded_sides: { ...existing.uploaded_sides } } }) };
    }
    if (url.endsWith('/submit')) {
      existing.status = 'pending_manual_review'; existing.ocr_execution_status = 'provider_succeeded'; existing.ocr_result = { first_name: 'Synthetic' };
      return { ok: true, json: async () => ({ session: { ...existing } }) };
    }
    if (url.endsWith(id)) return { ok: true, json: async () => ({ session: { ...existing } }) };
    throw new Error('Unexpected request');
  };
  const input = { docType: 'passport', doubleSided: false, capturedFront: 'synthetic', capturedSelfie: 'synthetic', onSession: got => { assert.equal(got, id); sentId = true; } };
  const outcome = await api.runVerificationSessionFlow(input);
  assert.equal(outcome.sessionId, id); assert.equal(outcome.needsConfirmation, true);
  const mutations = calls.filter(x => x[1] === 'POST' && !x[0].endsWith('/csrf-token'));
  assert.equal(mutations.length, 4);
  assert.ok(mutations.every(x => x[2]['x-csrf-token'] === 'fixture-csrf' && x[2]['x-session-token'] === 'fixture-token'));
  const before = calls.length;
  const recovered = await api.runVerificationSessionFlow(input); // no in-memory session ID, as after restart
  assert.equal(recovered.sessionId, id);
  assert.equal(calls.slice(before).filter(x => x[1] === 'POST').length, 0);
});

test('a restarted partial upload reuses the session and replaces the captured set', async () => {
  const id = '12345678-1234-4234-8234-123456789013';
  const session = { id, document_type: 'passport', double_sided: false, status: 'captured', uploaded_sides: { front: true, back: false, selfie: false }, ocr_result: null };
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push([url, method]);
    if (url.endsWith('/csrf-token')) return { ok: true, json: async () => ({ csrfToken: 'fixture-csrf' }) };
    if (url.endsWith('/latest')) return { ok: true, json: async () => ({ session: { ...session } }) };
    if (url.includes('/upload/')) { session.uploaded_sides[url.split('/').pop()] = true; session.status = 'uploaded'; return { ok: true, json: async () => ({ session: { ...session, uploaded_sides: { ...session.uploaded_sides } } }) }; }
    if (url.endsWith('/submit')) { session.status = 'ocr_failed'; return { ok: true, json: async () => ({ session: { ...session } }) }; }
    throw new Error('Unexpected request');
  };
  const result = await api.runVerificationSessionFlow({ docType: 'passport', doubleSided: false, capturedFront: 'new-front', capturedSelfie: 'new-selfie' });
  assert.equal(result.sessionId, id); assert.equal(result.status, 'ocr_failed');
  assert.equal(calls.filter(([url]) => url.includes('/upload/')).length, 2);
  assert.equal(calls.some(([url, method]) => url.endsWith('/verification-sessions') && method === 'POST'), false);
});

test('expired authentication prevents uploads and session creation', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push([url, options.method || 'GET']);
    return { ok: false, status: 401, json: async () => ({ error: { message: 'Session expired' } }) };
  };
  await assert.rejects(() => api.runVerificationSessionFlow({ docType: 'passport', doubleSided: false, capturedFront: 'synthetic', capturedSelfie: 'synthetic' }), /Session expired/);
  assert.equal(calls.length, 1); assert.ok(calls[0][0].endsWith('/latest'));
});
