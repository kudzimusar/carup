/**
 * O2 Owner-UAT closure — the three defects the owner UAT found on #208's own deployed runtime.
 *
 * Each was measured against a positive control before being called a defect, and each fix is O2
 * closing its own gap with O2's own established pattern. Nothing here is imported from another lane.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

/* ── 1 · deciding an identity is a SENSITIVE action ────────────────────────
   Measured: a ghost session id returned 404 (the handler ran) while the dealer decision returned
   403 STEP_UP_REQUIRED before any lookup. Viewing the evidence was already gated; deciding was not. */

test('O2-UAT-1: the identity DECISION route requires reviewer capability AND step-up', () => {
  const routes = read('backend/routes/identityVerificationAdminRoutes.js');
  const at = routes.indexOf("verification-sessions/:sessionId/review");
  assert.ok(at > -1, 'the decision route must exist');
  const guards = routes.slice(at, routes.indexOf('asyncHandler', at));
  assert.match(guards, /authorizeRole\(\['admin'\]\)/, 'reviewer capability is required');
  assert.match(guards, /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/,
    'a sensitive-action step-up is required to DECIDE an identity');
});

test('O2-UAT-2: every consequential admin identity route is step-up gated, not just some', () => {
  const routes = read('backend/routes/identityVerificationAdminRoutes.js');
  // Both the decision and the raw-evidence preview change or expose something consequential.
  for (const marker of ['verification-sessions/:sessionId/review', 'evidence/:side/preview']) {
    const at = routes.indexOf(marker);
    assert.ok(at > -1, `${marker} must exist`);
    const guards = routes.slice(at, routes.indexOf('asyncHandler', at));
    assert.match(guards, /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/, `${marker} must demand step-up`);
  }
});

/* ── 2 · a governed refusal is not a database failure ─────────────────────
   Measured: "only current owner or governance may initiate transfer" (SQLSTATE 42501) and
   "an active ownership transfer already exists" (23505) both reached the caller as HTTP 500
   DATABASE_ERROR, telling the operator CarUp had broken when CarUp had refused. */

const { ForbiddenError, NotFoundError, ConflictError, ValidationError, DatabaseError } =
  await import('../utils/errors.js');
const svc = await import('../services/passport/passportOwnershipTransferService.js');

function rpcClient(error) {
  return { rpc: async () => ({ data: null, error }) };
}
const ACTOR = { id: 'u-gov', role: 'admin' };

const CASES = [
  ['42501', 'only current owner or governance may initiate transfer', ForbiddenError, 403],
  ['P0002', 'ownership transfer not found', NotFoundError, 404],
  ['23505', 'an active ownership transfer already exists for this vehicle', ConflictError, 409],
  ['23514', 'governed current owner is required before transfer', ConflictError, 409],
  ['22023', 'transfer id, target state and actor are required', ValidationError, 400],
];

for (const [code, message, Expected, status] of CASES) {
  test(`O2-UAT-3 [${code}]: "${message.slice(0, 44)}…" is a ${Expected.name}, not a 500`, async () => {
    await assert.rejects(
      () => svc.beginOwnershipTransfer(rpcClient({ code, message }), { vin: 'V', incomingOwnerId: 'u-new' }, ACTOR),
      (e) => {
        assert.ok(e instanceof Expected, `expected ${Expected.name}, got ${e.constructor.name}`);
        assert.ok(!(e instanceof DatabaseError), 'a governed refusal must not be a DatabaseError');
        if (typeof e.statusCode === 'number') assert.equal(e.statusCode, status);
        assert.match(e.message, new RegExp(message.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          "the provider's own words must survive");
        return true;
      },
    );
  });
}

test('O2-UAT-4: a genuinely unexpected failure is STILL a DatabaseError', async () => {
  await assert.rejects(
    () => svc.beginOwnershipTransfer(rpcClient({ code: '08006', message: 'connection failure' }), { vin: 'V', incomingOwnerId: 'u-new' }, ACTOR),
    (e) => { assert.ok(e instanceof DatabaseError, 'an unknown fault must not be dressed up as a refusal'); return true; },
  );
});

test('O2-UAT-5: the transition path translates too, not only the begin path', () => {
  const raw = read('backend/services/passport/passportOwnershipTransferService.js');
  // Assert on the CODE, not the prose: the file documents the old behaviour by name, and matching
  // that would fail the file for explaining itself. This is the third time today that a check of
  // mine read a comment and reported it as the thing the comment warns about.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  const flattened = source.match(/throw new DatabaseError\('Failed to (begin|transition|read) ownership transfer/g) || [];
  assert.deepEqual(flattened, [], 'no RPC error may be flattened straight into a DatabaseError');
  // THROW sites only — the function's own declaration matches a looser pattern and made this
  // count 4, which is the assertion being wrong rather than the code.
  assert.equal((source.match(/throw translateTransferError\(error, /g) || []).length, 3,
    'begin, transition and read must all translate');
});

/* ── 3 · workbook phone composition ───────────────────────────────────────
   The first owner closure used flex-wrap as a minimal 393px repair. Mobile-first remediation now
   deliberately replaces those desktop buttons with a four-column phone tab strip. */

test('O2-UAT-6: the workbook header and tabs use the deliberate compact phone composition', () => {
  const source = read('web/src/components/workbook/WorkbookWorkspace.tsx');
  const at = source.indexOf("{title || 'Workbook tools'}");
  assert.ok(at > -1, 'the workbook header must exist');
  const block = source.slice(Math.max(0, at - 500), at + 900);
  const header = block.match(/className="space-y-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0"/);
  assert.ok(header, 'the header must stack on phones and become a row only from sm');
  const tabs = block.match(/className="grid w-full grid-cols-4 gap-1 rounded-lg bg-muted p-1 sm:w-auto"/);
  assert.ok(tabs, 'the phone tab group must be a contained four-column grid');
  assert.match(block, /role="tablist"/, 'the compact group must preserve tab semantics');
  assert.match(block, /min-h-10 min-w-0 px-1 text-\[11px\]/,
    'phone tabs must use compact typography without forcing desktop minimum widths');
});
