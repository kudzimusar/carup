/**
 * errorHandler HTTP-status contract.
 *
 * Services across the backend (auth, password, evidence, and every Communications 2.0
 * service) raise operational failures as a plain Error carrying a numeric `statusCode`
 * rather than a CarUpError subclass. Staging UAT caught the consequence: a participant
 * who is not on a conversation got HTTP 500 instead of 404, so a deliberate refusal was
 * indistinguishable from an outage to clients, retry logic and 5xx alerting.
 *
 * These tests pin the contract in both directions — a deliberate 4xx is honoured, and a
 * genuine server fault still reports the generic message rather than its own text.
 *
 * They deliberately mutate NO global state (no process.env writes): the detail-exposure
 * branch is environment-dependent and is asserted only through the message/code fields,
 * which are identical in every environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import errorHandler from '../middleware/errorMiddleware.js';

const GENERIC_MESSAGE = 'An unexpected internal server error occurred';

function runHandler(err) {
  const captured = { status: null, body: null };
  const res = {
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  };
  errorHandler(err, { correlationId: 'test-correlation', path: '/api/test', method: 'GET' }, res, () => {});
  return captured;
}

test('a plain Error carrying statusCode 404 answers 404, not 500', () => {
  const err = new Error('Conversation not found.');
  err.statusCode = 404;
  const { status, body } = runHandler(err);
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.message, 'Conversation not found.');
});

test('every deliberate client status is honoured with its machine code', () => {
  for (const [statusCode, code] of [[400, 'BAD_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [409, 'CONFLICT'], [429, 'TOO_MANY_REQUESTS']]) {
    const err = new Error(`refused ${statusCode}`);
    err.statusCode = statusCode;
    const { status, body } = runHandler(err);
    assert.equal(status, statusCode);
    assert.equal(body.error.code, code);
    assert.equal(body.error.message, `refused ${statusCode}`);
  }
});

test('an author-supplied error code is preserved over the status default', () => {
  const err = new Error('Unsupported smoke-test channel: carrier-pigeon');
  err.statusCode = 400;
  err.code = 'unsupported_channel';
  const { body } = runHandler(err);
  assert.equal(body.error.code, 'unsupported_channel');
});

test('a plain Error with no statusCode is still a generic 500', () => {
  const { status, body } = runHandler(new Error('supabase socket exploded'));
  assert.equal(status, 500);
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(body.error.message, GENERIC_MESSAGE, 'internal failure text must not become the client message');
});

test('an explicit 5xx is honoured but keeps the generic message', () => {
  const err = new Error('upstream provider credentials rejected');
  err.statusCode = 503;
  const { status, body } = runHandler(err);
  assert.equal(status, 503, 'the deliberate status is still honoured');
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(body.error.message, GENERIC_MESSAGE, 'a server fault must not surface its own text as the message');
});

test('a nonsense statusCode is ignored rather than sent to the client', () => {
  for (const bogus of [0, 99, 700, 'four-oh-four', null, NaN]) {
    const err = new Error('bad status');
    err.statusCode = bogus;
    assert.equal(runHandler(err).status, 500, `statusCode ${String(bogus)} must not be honoured`);
  }
});

test('a CarUpError-shaped error keeps its own status, code and message', async () => {
  const { NotFoundError } = await import('../utils/errors.js');
  const { status, body } = runHandler(new NotFoundError('Listing not found.', { vin: 'VIN-1' }));
  assert.equal(status, 404);
  assert.equal(body.error.message, 'Listing not found.');
});
