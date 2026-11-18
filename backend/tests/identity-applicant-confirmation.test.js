import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmApplicantOcr, validateApplicantFields } from '../services/identity/applicantOcrConfirmation.js';

const actor = { id: 'user-1' };
const token = 'd8b92a3f-bb1c-4418-83cf-2c374801aa37';
const fields = { first_name: 'Ada', last_name: 'Banda', national_id_number: 'AB123', date_of_birth: '1990-01-05' };
function client({ owner = 'user-1', code = 'OK' } = {}) {
  let filteredUser;
  let calls = 0;
  return {
    get calls() { return calls; },
    from() { return { select() { return this; }, eq(key, value) { if (key === 'user_id') filteredUser = value; return this; }, async maybeSingle() { return { data: filteredUser === owner ? { id: 'case', user_id: owner, document_type: 'passport' } : null, error: null }; } }; },
    async rpc(_name, args) { calls++; return { data: { code, id: 'confirmation', version: args.p_expected_version + 1, created_at: '2026-01-01', replayed: false }, error: null }; },
  };
}
test('valid declaration is passed separately with actor and revision', async () => {
  const db = client();
  const result = await confirmApplicantOcr(db, actor, 'case', { revision: 3, idempotencyKey: token, fields });
  assert.equal(result.revision, 4); assert.equal(db.calls, 1);
});
test('invalid fields, malformed dates and unsupported types fail before persistence', () => {
  assert.throws(() => validateApplicantFields('passport', { ...fields, extra: 'secret' }), /Invalid/);
  assert.throws(() => validateApplicantFields('passport', { ...fields, date_of_birth: '2025-02-30' }), /valid/);
  assert.throws(() => validateApplicantFields('passport', { ...fields, first_name: '' }), /Required/);
  assert.throws(() => validateApplicantFields('residence_permit', fields), /does not support/);
});
test('cross-user and stale, terminal or repeated conflicting requests are denied', async () => {
  const other = client({ owner: 'someone-else' });
  await assert.rejects(() => confirmApplicantOcr(other, actor, 'case', { revision: 3, idempotencyKey: token, fields }), /not found/i);
  assert.equal(other.calls, 0);
  for (const code of ['STALE_VERSION', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT', 'ALREADY_CONFIRMED']) {
    await assert.rejects(() => confirmApplicantOcr(client({ code }), actor, 'case', { revision: 3, idempotencyKey: token, fields }), /changed or cannot be confirmed/);
  }
});

test('confirmation fields derive from the relevant national ID, passport and licence schemas', async () => {
  const { identityConfirmationFields } = await import('../services/identity/applicantOcrConfirmation.js');
  for (const type of ['national_id', 'passport', 'driver_license']) {
    const spec = identityConfirmationFields(type);
    assert.ok(spec.some(x => x.name === 'first_name' && x.required));
    assert.ok(spec.some(x => x.name === 'national_id_number' && x.required));
    assert.deepEqual(validateApplicantFields(type, fields), fields);
  }
  const passport = { ...fields, passport_number: 'AB123', nationality: 'Zimbabwean', expiry: '2030-01-05', issuing_authority: 'Registrar' };
  assert.deepEqual(validateApplicantFields('passport', passport), passport);
  const licence = { ...fields, licence_number: 'DL123', licence_classes: 'B', expiry: '2030-01-05' };
  assert.deepEqual(validateApplicantFields('driver_license', licence), licence);
  assert.throws(() => validateApplicantFields('national_id', { ...fields, passport_number: 'AB123' }), /Invalid/);
  assert.throws(() => validateApplicantFields('passport', { ...fields, licence_classes: 'B' }), /Invalid/);
  assert.throws(() => validateApplicantFields('passport', { ...fields, expiry: '2025-02-30' }), /Invalid/);
  assert.throws(() => validateApplicantFields('national_id', { ...fields, sex: 'unreadable' }), /Invalid/);
  assert.deepEqual(identityConfirmationFields('residence_permit'), []);
});

test('synthetic RPC models lost response, idempotent replay and changed-payload conflict', async () => {
  const db = client();
  let stored;
  db.rpc = async (_name, args) => {
    if (!stored) {
      stored = structuredClone(args);
      return { data: { code: 'OK', id: 'confirmation', version: 4, created_at: '2026-01-01', replayed: false }, error: null };
    }
    if (JSON.stringify(stored.p_fields) !== JSON.stringify(args.p_fields)) return { data: { code: 'IDEMPOTENCY_CONFLICT' }, error: null };
    return { data: { code: 'OK', id: 'confirmation', version: 4, created_at: '2026-01-01', replayed: true }, error: null };
  };
  const input = { revision: 3, idempotencyKey: token, fields };
  await confirmApplicantOcr(db, actor, 'case', input); // response lost after commit
  const replay = await confirmApplicantOcr(db, actor, 'case', input);
  assert.equal(replay.replayed, true); assert.equal(replay.id, 'confirmation');
  await assert.rejects(() => confirmApplicantOcr(db, actor, 'case', { ...input, fields: { ...fields, first_name: 'Edited' } }), /changed or cannot be confirmed/);
});
