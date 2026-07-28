/**
 * Confirmed workbook import — the confirmation token (Deliverable B, Issue #127).
 *
 * A dry-run tells a user what WOULD happen. Turning that into "do it" needs more than a button,
 * because the two are separated in time and the thing being confirmed can change in between. The
 * confirmation is therefore bound to the exact artefact it describes:
 *
 *   tenant + batch + workbook checksum + dry-run revision + user + expiry + idempotency key
 *
 * Each binding closes a specific hole:
 *
 *   · **checksum** — re-uploading an edited workbook produces a different checksum, so the stored
 *     confirmation can no longer match and execution is refused. "Changed workbook invalidates the
 *     confirmation" becomes a property of the data model rather than a UI courtesy.
 *   · **dry-run revision** — the same bytes re-validated under changed reference data (a supplier
 *     de-listed, a quota exhausted) is a different proposal, even though the checksum is identical.
 *   · **expiry** — a confirmation minted an hour ago should not authorize an import next week,
 *     when the evidence it rested on may no longer hold.
 *   · **idempotency key** — a double-click, a reload, or a retried request converge on ONE
 *     confirmation instead of two imports.
 *   · **tenant + user** — the confirmation is attributable, and cannot be replayed across tenants.
 *
 * Nothing here writes domain data. It issues, validates and consumes the token that authorizes the
 * execution service to do so.
 */
import { resolveClient, appendCriticalAudit } from '../diasporaServiceUtils.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../utils/errors.js';
import { WORKBOOK_IMPORT_STATUSES } from '../../../constants/diaspora/diasporaWorkbookImportStatuses.js';

export const CONFIRMATIONS_TABLE = 'diaspora_workbook_import_confirmations';
export const BATCHES_TABLE = 'diaspora_workbook_import_batches';

export const CONFIRMATION_STATE = Object.freeze({
  PENDING: 'pending',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
  INVALIDATED: 'invalidated',
});

/**
 * How long a confirmation stays usable.
 *
 * Long enough for a human to review a preview and click through; short enough that an abandoned tab
 * cannot authorize an import after the underlying data has moved on.
 */
export const CONFIRMATION_TTL_MINUTES = 30;

/** The statuses a batch may be in when a confirmation is issued. */
const CONFIRMABLE_STATUSES = new Set([
  WORKBOOK_IMPORT_STATUSES.VALIDATED,
  WORKBOOK_IMPORT_STATUSES.READY_FOR_REVIEW,
]);

const UNIQUE_VIOLATION = '23505';

function requireActor(userContext) {
  if (!userContext?.id) throw new ForbiddenError('A confirmed workbook import requires an authenticated user');
  return userContext;
}

function normalizeChecksum(value) {
  const s = String(value || '').trim();
  return s ? s.toLowerCase() : null;
}

export async function fetchBatch(supabase, batchId) {
  const { data, error } = await supabase
    .from(BATCHES_TABLE).select('*').eq('id', batchId).is('deleted_at', null).maybeSingle();
  if (error) throw new ValidationError(`Failed to read the workbook batch: ${error.message}`);
  if (!data) throw new NotFoundError('Workbook batch not found');
  return data;
}

/**
 * The dry-run revision for a batch.
 *
 * Derived rather than stored as its own column so it cannot drift from the thing it describes: every
 * re-validation bumps the batch's `updated_at`, and the revision counter lives in metadata alongside
 * it. A batch that has never been re-validated is revision 1.
 */
export function dryRunRevisionOf(batch) {
  const meta = batch?.metadata || {};
  const raw = meta?.workbook?.dryRunRevision ?? meta?.dryRunRevision ?? 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/**
 * Issue a confirmation.
 *
 * Refuses unless the batch is confirmable, the supplied checksum matches the batch's stored
 * checksum, and the caller belongs to the batch's tenant. The checksum comparison is the load-bearing
 * one: the client sends the checksum of the workbook it PREVIEWED, and if that no longer matches what
 * the server has, the user is looking at a stale preview.
 */
export async function createConfirmation({
  batchId,
  workbookChecksum,
  idempotencyKey,
  ttlMinutes = CONFIRMATION_TTL_MINUTES,
  userContext,
  supabaseClient = null,
  req = null,
  now = null,
} = {}) {
  requireActor(userContext);
  if (!batchId) throw new ValidationError('A confirmation requires a batch id');
  if (!idempotencyKey) throw new ValidationError('A confirmation requires an idempotency key');

  const supabase = await resolveClient({ supabaseClient });
  const batch = await fetchBatch(supabase, batchId);

  // Tenant binding. A confirmation must never be issuable across tenants, even by an admin who can
  // read the batch — the import writes into the batch's tenant, not the caller's.
  const batchTenant = batch.tenant_id || null;
  if (batchTenant && userContext.tenantId && String(batchTenant) !== String(userContext.tenantId)) {
    throw new ForbiddenError('This workbook batch belongs to a different organisation');
  }

  const status = String(batch.import_status || '').toUpperCase();
  if (!CONFIRMABLE_STATUSES.has(status)) {
    throw new ValidationError(`A workbook in ${status} cannot be confirmed for import`, {
      batchId, importStatus: status, errorCode: 'BATCH_NOT_CONFIRMABLE',
    });
  }

  // A workbook with known-bad rows is never confirmable. The preview showed those errors; confirming
  // anyway would import a subset the user never actually agreed to.
  const rejected = Number(batch.rejected_rows ?? batch.rejectedRows ?? 0);
  const errors = Number(batch.error_count ?? batch.errorCount ?? 0);
  if (rejected > 0 || errors > 0) {
    throw new ValidationError('A workbook with rejected rows or validation errors cannot be confirmed', {
      batchId, rejectedRows: rejected, errorCount: errors, errorCode: 'BATCH_HAS_ERRORS',
    });
  }

  const storedChecksum = normalizeChecksum(batch.checksum_sha256);
  const suppliedChecksum = normalizeChecksum(workbookChecksum);
  if (!storedChecksum) {
    throw new ValidationError('This workbook batch has no recorded checksum, so it cannot be confirmed', {
      batchId, errorCode: 'BATCH_CHECKSUM_MISSING',
    });
  }
  if (!suppliedChecksum || suppliedChecksum !== storedChecksum) {
    // The user is confirming a preview that no longer matches the stored workbook.
    throw new ValidationError('The workbook has changed since this preview was generated. Re-run the dry run and review it again.', {
      batchId, errorCode: 'WORKBOOK_CHECKSUM_MISMATCH',
    });
  }

  const revision = dryRunRevisionOf(batch);
  const clock = now ? new Date(now) : new Date();
  const expiresAt = new Date(clock.getTime() + Math.max(1, Number(ttlMinutes) || CONFIRMATION_TTL_MINUTES) * 60000).toISOString();

  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE)
    .insert({
      tenant_id: batchTenant || userContext.tenantId,
      batch_id: batchId,
      workbook_checksum: storedChecksum,
      dry_run_revision: revision,
      confirmed_by: userContext.id,
      confirmed_at: clock.toISOString(),
      expires_at: expiresAt,
      idempotency_key: String(idempotencyKey),
      state: CONFIRMATION_STATE.PENDING,
      row_count: Number(batch.total_rows ?? batch.totalRows ?? 0) || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION || /duplicate key/i.test(error.message || '')) {
      // Two distinct collisions land here and they mean different things.
      const existing = await findByIdempotencyKey(supabase, batchTenant || userContext.tenantId, idempotencyKey);
      if (existing) return { confirmation: existing, replay: true };
      // Otherwise the partial unique index fired: a live confirmation already exists for this exact
      // batch+checksum+revision. Return it rather than minting a second one.
      const live = await findLiveConfirmation(supabase, { batchId, checksum: storedChecksum, revision });
      if (live) return { confirmation: live, replay: true };
    }
    throw new ValidationError(`Failed to record the import confirmation: ${error.message}`);
  }

  await appendCriticalAudit(supabase, {
    tenantId: data.tenant_id,
    actorId: userContext.id,
    action: 'DIASPORA_WORKBOOK_IMPORT_CONFIRMED',
    resourceType: 'diaspora_workbook_import_batch',
    resourceId: batchId,
    newState: { confirmationId: data.id, checksum: storedChecksum, revision, expiresAt },
    req,
  });

  return { confirmation: data, replay: false };
}

async function findByIdempotencyKey(supabase, tenantId, idempotencyKey) {
  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE).select('*')
    .eq('tenant_id', tenantId).eq('idempotency_key', String(idempotencyKey)).maybeSingle();
  if (error) throw new ValidationError(`Failed to read the import confirmation: ${error.message}`);
  return data || null;
}

async function findLiveConfirmation(supabase, { batchId, checksum, revision }) {
  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE).select('*')
    .eq('batch_id', batchId)
    .eq('workbook_checksum', checksum)
    .eq('dry_run_revision', revision)
    .eq('state', CONFIRMATION_STATE.PENDING)
    .maybeSingle();
  if (error) throw new ValidationError(`Failed to read the import confirmation: ${error.message}`);
  return data || null;
}

export async function getConfirmation(confirmationId, { supabaseClient = null } = {}) {
  if (!confirmationId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE).select('*').eq('id', confirmationId).maybeSingle();
  if (error) throw new ValidationError(`Failed to read the import confirmation: ${error.message}`);
  return data || null;
}

/**
 * Validate a confirmation against the CURRENT batch.
 *
 * Re-reads and re-compares rather than trusting the row: between issue and execution the workbook may
 * have been re-uploaded or re-validated, and the whole point of the binding is to notice.
 *
 * Returns `{ ok, confirmation, batch, reason }` — never throws for an invalid confirmation, so the
 * caller can turn each reason into a specific, actionable message.
 */
export async function validateConfirmation({
  confirmationId,
  batchId,
  userContext,
  supabaseClient = null,
  now = null,
} = {}) {
  requireActor(userContext);
  const supabase = await resolveClient({ supabaseClient });

  const confirmation = await getConfirmation(confirmationId, { supabaseClient: supabase });
  if (!confirmation) return { ok: false, reason: 'CONFIRMATION_NOT_FOUND', confirmation: null, batch: null };
  if (batchId && String(confirmation.batch_id) !== String(batchId)) {
    return { ok: false, reason: 'CONFIRMATION_BATCH_MISMATCH', confirmation, batch: null };
  }
  if (userContext.tenantId && confirmation.tenant_id && String(confirmation.tenant_id) !== String(userContext.tenantId)) {
    return { ok: false, reason: 'CONFIRMATION_TENANT_MISMATCH', confirmation, batch: null };
  }
  if (confirmation.state !== CONFIRMATION_STATE.PENDING) {
    return { ok: false, reason: `CONFIRMATION_${String(confirmation.state).toUpperCase()}`, confirmation, batch: null };
  }

  const clock = now ? new Date(now) : new Date();
  if (confirmation.expires_at && new Date(confirmation.expires_at) <= clock) {
    await supabase.from(CONFIRMATIONS_TABLE)
      .update({ state: CONFIRMATION_STATE.EXPIRED })
      .eq('id', confirmation.id).eq('state', CONFIRMATION_STATE.PENDING);
    return { ok: false, reason: 'CONFIRMATION_EXPIRED', confirmation, batch: null };
  }

  const batch = await fetchBatch(supabase, confirmation.batch_id);

  // The decisive re-check. If the workbook was re-uploaded, the stored checksum has moved and this
  // confirmation describes a workbook that is no longer the one on file.
  if (normalizeChecksum(batch.checksum_sha256) !== normalizeChecksum(confirmation.workbook_checksum)) {
    return { ok: false, reason: 'WORKBOOK_CHECKSUM_CHANGED', confirmation, batch };
  }
  // Same bytes, different validation outcome — still a different proposal.
  if (dryRunRevisionOf(batch) !== confirmation.dry_run_revision) {
    return { ok: false, reason: 'DRY_RUN_REVISION_CHANGED', confirmation, batch };
  }

  return { ok: true, reason: null, confirmation, batch };
}

/**
 * Consume a confirmation — single-use, guarded against a concurrent second consumer.
 *
 * The `.eq('state', PENDING)` in the UPDATE is the guard: two requests racing the same confirmation
 * both attempt the transition, exactly one matches a pending row, and the loser gets null. Without
 * it, both would proceed and the workbook would import twice.
 */
export async function consumeConfirmation({ confirmationId, supabaseClient = null, now = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE)
    .update({ state: CONFIRMATION_STATE.CONSUMED, consumed_at: (now ? new Date(now) : new Date()).toISOString() })
    .eq('id', confirmationId)
    .eq('state', CONFIRMATION_STATE.PENDING)
    .select()
    .maybeSingle();
  if (error) throw new ValidationError(`Failed to consume the import confirmation: ${error.message}`);
  return data || null;
}

/**
 * Invalidate every live confirmation for a batch.
 *
 * Called when a batch is re-validated or re-uploaded. Strictly speaking the checksum/revision
 * re-check at execution time already refuses a stale confirmation, but leaving it `pending` would
 * show the user a confirmation that looks live and fails on use. Invalidating makes the UI honest.
 */
export async function invalidateConfirmationsForBatch({
  batchId, reason = 'WORKBOOK_REVALIDATED', supabaseClient = null,
} = {}) {
  if (!batchId) return [];
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(CONFIRMATIONS_TABLE)
    .update({ state: CONFIRMATION_STATE.INVALIDATED, invalidated_reason: String(reason).slice(0, 200) })
    .eq('batch_id', batchId)
    .eq('state', CONFIRMATION_STATE.PENDING)
    .select();
  if (error) throw new ValidationError(`Failed to invalidate import confirmations: ${error.message}`);
  return data || [];
}

/** Every reason a confirmation can be refused, with the message a user should actually see. */
export const CONFIRMATION_REFUSAL_MESSAGES = Object.freeze({
  CONFIRMATION_NOT_FOUND: 'That confirmation could not be found. Re-run the dry run and confirm again.',
  CONFIRMATION_BATCH_MISMATCH: 'That confirmation belongs to a different workbook.',
  CONFIRMATION_TENANT_MISMATCH: 'That confirmation belongs to a different organisation.',
  CONFIRMATION_CONSUMED: 'This workbook has already been imported. Nothing was imported twice.',
  CONFIRMATION_EXPIRED: 'This confirmation has expired. Review the preview again and confirm.',
  CONFIRMATION_INVALIDATED: 'This confirmation is no longer valid because the workbook was re-validated.',
  WORKBOOK_CHECKSUM_CHANGED: 'The workbook has changed since you confirmed it. Nothing was imported. Review the new preview and confirm again.',
  DRY_RUN_REVISION_CHANGED: 'This workbook was re-validated after you confirmed it. Nothing was imported. Review the new preview and confirm again.',
});

export function explainRefusal(reason) {
  return CONFIRMATION_REFUSAL_MESSAGES[reason]
    || 'This import could not be confirmed. Re-run the dry run and try again.';
}
