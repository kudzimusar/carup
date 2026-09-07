/**
 * Trade OS T8.3 — one Documents & Evidence workspace, for any authoritative Trade OS object.
 *
 * Before this, documents lived on a procurement-only page and nowhere else: a logistics request or
 * a container booking could own a document (T8.1) that no screen could show. This projects the
 * canonical records — the governed type vocabulary, the participant-stated readiness, the document
 * itself and its verification — into ONE surface, per transaction.
 *
 * It PROJECTS. It is not an authority: it creates nothing, verifies nothing, and every status it
 * reports is read from the layer that owns it.
 *
 * The seven truths stay seven (root contract §19):
 *
 *   FILE EXISTS → PRESENT → CLASSIFIED → EXTRACTED → REVIEWED → VERIFIED → FACT VERIFIED
 *
 * so a checklist row says "Present — awaiting review" until an authorized reviewer has actually
 * looked, and never "Verified" because a file arrived.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId } from './diasporaAuthorization.js';
import { canReceiveAtWarehouse } from './warehouseAuthority.js';
import { resolveClient } from './diasporaServiceUtils.js';

const DOCUMENTS = 'diaspora_trade_documents';
const TYPES = 'trade_document_types';
const READINESS = 'diaspora_trade_document_readiness';

export const WORKSPACE_SUBJECTS = Object.freeze(['import_order', 'logistics_request', 'container_booking', 'trade_order', 'warehouse_intake']);

/**
 * What a checklist row may say. Deliberately small: every value is established by a layer that
 * actually owns it, and nothing here can be inferred from a file merely existing.
 */
export const CHECKLIST_STATES = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',   // the participant said it does not apply
  REQUESTED: 'REQUESTED',             // somebody asked for it
  MISSING: 'MISSING',                 // expected, nothing supplied
  PRESENT: 'PRESENT',                 // supplied, nobody has reviewed it
  AWAITING_REVIEW: 'AWAITING_REVIEW', // supplied, and this type requires a verdict
  VERIFIED: 'VERIFIED',               // an authorized reviewer verified it
  REJECTED: 'REJECTED',               // an authorized reviewer rejected it
});

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

/**
 * Who may open this transaction's documents.
 *
 * Derived entirely from the transaction, never from anything the caller sends. Co-loaders share a
 * sailing, not each other's evidence: a container participant sees the sailing's documents that are
 * bound to the sailing, and their OWN booking documents — never another participant's.
 */
async function authorizeSubject(client, subjectType, subjectId, context) {
  if (privileged(context)) return { role: 'reviewer' };

  if (subjectType === 'import_order' || subjectType === 'trade_order') {
    const { data: order } = await client.from('diaspora_import_orders').select('*')
      .eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!order) throw new NotFoundError('Transaction not found');
    if ([order.buyer_id, order.created_by].some((c) => normalizeId(c) === context.id)) return { role: 'buyer' };
    const { data: quote } = await client.from('diaspora_import_quotes').select('id')
      .eq('import_order_id', subjectId).eq('seller_id', context.id).is('deleted_at', null).limit(1).maybeSingle();
    if (quote) return { role: 'supplier' };
    throw new ForbiddenError('You are not a participant in this transaction');
  }

  if (subjectType === 'logistics_request') {
    const { data: request } = await client.from('diaspora_logistics_requests').select('*')
      .eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!request) throw new NotFoundError('Transaction not found');
    if ([request.requester_id, request.created_by].some((c) => normalizeId(c) === context.id)) return { role: 'requester' };
    // A provider earns it with an offer — seeing the marketplace listing is not participation.
    const { data: quote } = await client.from('diaspora_logistics_quotes').select('id, status')
      .eq('logistics_request_id', subjectId).eq('provider_id', context.id).is('deleted_at', null).limit(1).maybeSingle();
    if (quote) return { role: 'provider' };
    throw new ForbiddenError('You are not a participant in this transaction');
  }

  if (subjectType === 'container_booking') {
    const { data: container } = await client.from('diaspora_container_shipments').select('*')
      .eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!container) throw new NotFoundError('Sailing not found');
    const coordinator = normalizeId(container.coordinator_id || container.created_by);
    if ((coordinator && coordinator === context.id) || isTenantAdminForRecord(container, context)) {
      return { role: 'operator' };
    }
    const { data: reservations } = await client.from('diaspora_cargo_reservations').select('id, buyer_id, created_by, reservation_status')
      .eq('container_id', subjectId).is('deleted_at', null);
    const mine = (reservations || []).find((r) => normalizeId(r.buyer_id) === context.id || normalizeId(r.created_by) === context.id);
    if (mine) return { role: 'participant' };
    throw new ForbiddenError('You have no booking on this sailing');
  }

  // T9.5 — a warehouse intake's evidence is a document like any other, so it comes through here
  // rather than through a second store. Two parties may legitimately see it: the warehouse that
  // recorded the observation, and the customer whose cargo it is. Nobody else, ever — a co-loader
  // sharing a sailing does not share a consignment.
  if (subjectType === 'warehouse_intake') {
    const { data: intake } = await client.from('diaspora_warehouse_intakes').select('*')
      .eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!intake) throw new NotFoundError('Intake not found');
    const { data: warehouse } = await client.from('diaspora_warehouses').select('*')
      .eq('id', intake.warehouse_id).is('deleted_at', null).maybeSingle();
    if (warehouse && canReceiveAtWarehouse(warehouse, context)) return { role: 'warehouse' };

    const owners = intake.subject_type === 'cargo_reservation'
      ? await client.from('diaspora_cargo_reservations').select('buyer_id, created_by')
        .eq('id', intake.subject_id).is('deleted_at', null).maybeSingle()
      : await client.from('diaspora_logistics_requests').select('requester_id, created_by')
        .eq('id', intake.subject_id).is('deleted_at', null).maybeSingle();
    const ownerIds = [owners?.data?.buyer_id, owners?.data?.requester_id, owners?.data?.created_by]
      .map(normalizeId).filter(Boolean);
    if (ownerIds.includes(context.id)) return { role: 'cargo_owner' };
    throw new ForbiddenError('This is not your cargo');
  }

  throw new ValidationError(`Unknown document workspace subject "${subjectType}"`);
}

/** The status of ONE checklist row, from the layers that own each part of it. */
function projectRow(type, doc, readiness) {
  if (readiness === 'not_applicable') {
    return { state: CHECKLIST_STATES.NOT_APPLICABLE, note: 'Marked as not applicable to this transaction.' };
  }
  if (!doc) {
    return readiness === 'requested'
      ? { state: CHECKLIST_STATES.REQUESTED, note: 'Requested — not supplied yet.' }
      : { state: CHECKLIST_STATES.MISSING, note: 'Not supplied yet.' };
  }
  const status = String(doc.verification_status || '').toUpperCase();
  if (status === 'VERIFIED') return { state: CHECKLIST_STATES.VERIFIED, note: 'Checked and verified by CarUp.' };
  if (status === 'REJECTED') return { state: CHECKLIST_STATES.REJECTED, note: 'Reviewed and rejected. A corrected version can be supplied.' };
  // Supplied. Whether anybody is expected to look at it is the TYPE's business, not the file's.
  return type.verification_required
    ? { state: CHECKLIST_STATES.AWAITING_REVIEW, note: 'Supplied. Nobody has checked it yet.' }
    : { state: CHECKLIST_STATES.PRESENT, note: 'Supplied. This kind of document is not checked by CarUp.' };
}

/**
 * Build the workspace for one transaction.
 *
 * Bounded reads: three queries regardless of how many document types or documents exist. The
 * per-row lookups are done in memory, not in the database.
 */
export async function buildDocumentWorkspace(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  if (!WORKSPACE_SUBJECTS.includes(String(subjectType))) {
    throw new ValidationError(`Unknown document workspace subject "${subjectType}"`);
  }
  const client = await resolveClient(options);
  const { role } = await authorizeSubject(client, subjectType, subjectId, context);

  const [{ data: types }, { data: documents }, { data: readinessRows }] = await Promise.all([
    client.from(TYPES).select('*').is('deleted_at', null),
    // A workspace shows the CURRENT version of each document; the lineage is read per document.
    subjectType === 'import_order'
      ? client.from(DOCUMENTS).select('*').eq('import_order_id', subjectId).is('deleted_at', null).is('superseded_at', null)
      : client.from(DOCUMENTS).select('*').eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null).is('superseded_at', null),
    client.from(READINESS).select('*').eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null),
  ]);

  const docByType = new Map();
  for (const d of documents || []) if (!docByType.has(d.document_type)) docByType.set(d.document_type, d);
  const readinessByType = new Map((readinessRows || []).map((r) => [r.document_type, r.readiness]));

  const items = (types || []).map((type) => {
    const doc = docByType.get(type.code) || null;
    const { state, note } = projectRow(type, doc, readinessByType.get(type.code));
    return {
      document_type: type.code,
      display_name: type.display_name,
      verification_required: Boolean(type.verification_required),
      state,
      note,
      document: doc ? {
        id: doc.id,
        version: Number(doc.version || 1),
        // WHO supplied it and WHEN — the provenance a reader needs to weigh it.
        supplied_by: doc.uploaded_by || null,
        supplied_at: doc.created_at || null,
        reviewed_by: doc.reviewed_by || null,
        reviewed_at: doc.reviewed_at || null,
        // Extraction is an OBSERVATION. Its presence never advances the state above.
        has_extraction: Boolean(doc.ocr_document_id),
        has_earlier_versions: Number(doc.version || 1) > 1,
      } : null,
    };
  }).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const supplied = items.filter((i) => i.document).length;
  return {
    subject: { type: subjectType, id: subjectId },
    viewer_role: role,
    items,
    summary: {
      total: items.length,
      supplied,
      verified: items.filter((i) => i.state === CHECKLIST_STATES.VERIFIED).length,
      awaiting_review: items.filter((i) => i.state === CHECKLIST_STATES.AWAITING_REVIEW).length,
      rejected: items.filter((i) => i.state === CHECKLIST_STATES.REJECTED).length,
      // Deliberately NOT called "required". Nothing here establishes a legal requirement — T12 owns
      // that — so this counts what has been asked for, not what the law demands.
      requested_outstanding: items.filter((i) => i.state === CHECKLIST_STATES.REQUESTED).length,
    },
    // Said in the payload so no UI can imply otherwise.
    disclaimer: 'A document being present does not mean it has been checked, and a document being checked does not make what it describes true.',
  };
}
