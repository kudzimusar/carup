/**
 * CA-OWNER-02 (B) — the named Operations and Trust queues: what is waiting for CarUp, where, and since when.
 *
 * Each queue is read from its OWN table with the predicate the owning surface uses for "awaiting CarUp action" — never through
 * an existing list endpoint (several stop at 50/100/200 rows, which would understate the queue). Queues are never summed into
 * one risk or health score.
 *
 * Provenance: where the queued record has a principal K2B can judge (an account, or a vehicle and its owner), the queue
 * counts K2B-operational items only and carries what was set aside; UNKNOWN is never counted. Where it has none (referral
 * trust cases), the count is shown with an explicit "not provenance-filtered" label.
 *
 * Attention is presence only: no governed target exists for any of these queues, so an item is "waiting", never "late".
 */
import { deriveListingVisibility } from '../../marketplace/marketplaceModerationService.js';
import { readFact, CURRENT_WINDOW } from './managementFact.js';
import { readAllRows, unknownProvenance, extentOf } from './sourceReads.js';
import { createSourceContext } from './sourceContext.js';
import { k2bCount, byPrincipal } from './marketplaceDemandFacts.js';

const SCOPE_K2B = 'Staging · all CarUp organisations · K2B-operational items only';

/** Judge rows by the K2B class of their vehicle (owner identity included); an unknown vehicle is needs-review. */
async function byVehicle(ctx, rows, vinOf) {
  const index = await ctx.vehicleIndex(rows.map(vinOf));
  return rows.map((row) => ({ row, provenance: index.vehicle(vinOf(row)) ?? unknownProvenance('vehicle_not_found') }));
}

const timeOf = (...cols) => (c) => cols.map((col) => c.row?.[col]).find(Boolean) ?? null;

/** The named queues. `read(ctx)` resolves to { value, provenance?, extent?, detail? } or { complete: false }. */
export const QUEUES = Object.freeze([
  // ── Business Operations ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ops.marketplace_moderation', plane: 'operations', label: 'Listings awaiting moderation review', owner: 'Marketplace Operations',
    source: 'vehicles · Admin publication projection (pending review) · K2B', operate: { route: '/admin/moderation', label: 'Open Marketplace moderation queue' },
    detail: 'Oldest and newest are listing creation times; no moderation-entry time is recorded.',
    async read(ctx) {
      const base = await ctx.listingBase();
      if (!base.complete) return { complete: false };
      return k2bCount(base.classified, (c) => deriveListingVisibility(c.vehicle).public_status === 'pending_review', (c) => c.vehicle.created_at);
    },
  },
  {
    id: 'ops.marketplace_inquiry_new', plane: 'operations', label: 'New Marketplace inquiries awaiting first handling', owner: 'Marketplace Operations',
    source: 'marketplace_inquiries (status new) · K2B (asker + listing)', operate: { route: '/admin/moderation?tab=inquiries', label: 'Open Marketplace inquiry queue' },
    async read(ctx) {
      const inq = await ctx.inquiries();
      if (!inq.complete) return { complete: false };
      return k2bCount(inq.classified, (c) => c.row.status === 'new', (c) => c.row.created_at);
    },
  },
  {
    id: 'ops.communications_awaiting_reply', plane: 'operations', label: 'Operational conversations awaiting a reply', owner: 'Customer Operations',
    source: 'message_threads + messages · conversation truth (K2B on the real customer)', operate: { route: '/admin/communications', label: 'Open communications inbox' },
    detail: 'Certification, UAT and automation conversations are not counted.',
    async read(ctx) {
      const c = await ctx.communications();
      return { value: c.summary.operational.awaiting_reply, extent: { oldestAt: c.summary.operational.oldest_awaiting_since, newestAt: null } };
    },
  },
  {
    id: 'ops.garage_applications', plane: 'operations', label: 'Garage applications awaiting CarUp review', owner: 'Service Network',
    source: 'garage_applications (submitted, under review) · K2B (applicant)', operate: { route: '/admin/garage-applications', label: 'Open garage application queue' },
    detail: '"Information required" is the applicant\'s move and is not counted.',
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'garage_applications', 'id, applicant_user_id, status, submitted_at, created_at'))
        .filter((r) => ['submitted', 'under_review'].includes(r.status));
      return k2bCount(await byPrincipal(ctx, rows, (r) => r.applicant_user_id), () => true, timeOf('submitted_at', 'created_at'));
    },
  },
  {
    id: 'ops.diaspora_compliance', plane: 'operations', label: 'Trade compliance reviews pending', owner: 'Trade Compliance Operations',
    source: 'diaspora_compliance_reviews (PENDING_REVIEW) · K2B (creator)', operate: { route: '/admin/diaspora/compliance', label: 'Open Diaspora compliance review' },
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'diaspora_compliance_reviews', 'id, status, created_by, created_at, deleted_at'))
        .filter((r) => !r.deleted_at && r.status === 'PENDING_REVIEW');
      return k2bCount(await byPrincipal(ctx, rows, (r) => r.created_by), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'ops.diaspora_workbooks', plane: 'operations', label: 'Data-intake workbooks ready for review', owner: 'Trade Operations',
    source: 'diaspora_workbook_import_batches (READY_FOR_REVIEW) · K2B (creator)', operate: { route: '/admin/diaspora/workbooks', label: 'Open Diaspora data-intake workbooks' },
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'diaspora_workbook_import_batches', 'id, import_status, created_by, created_at, deleted_at'))
        .filter((r) => !r.deleted_at && r.import_status === 'READY_FOR_REVIEW');
      return k2bCount(await byPrincipal(ctx, rows, (r) => r.created_by), () => true, timeOf('created_at'));
    },
  },
  // ── Trust / Risk / Compliance ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'trust.identity_verification', plane: 'trust', label: 'Identity verification cases awaiting a reviewer', owner: 'Trust & Safety',
    source: 'verification_sessions (reviewer action required, escalated, or legacy manual review) · K2B (subject)', operate: { route: '/admin/verification', label: 'Open identity verification cases' },
    detail: 'Cases waiting on the applicant are not counted.',
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'verification_sessions', 'id, user_id, status, workflow_phase, submitted_at, created_at'))
        .filter((r) => ['reviewer_action_required', 'escalated'].includes(r.workflow_phase) || (!r.workflow_phase && r.status === 'pending_manual_review'));
      return k2bCount(await byPrincipal(ctx, rows, (r) => r.user_id), () => true, timeOf('submitted_at', 'created_at'));
    },
  },
  {
    id: 'trust.evidence', plane: 'trust', label: 'Vehicle evidence awaiting review', owner: 'Trust & Safety',
    source: 'vehicle_evidence (pending) · K2B (vehicle and owner)', operate: { route: '/admin/evidence', label: 'Open evidence review queue' },
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'vehicle_evidence', 'id, vin, verification_status, uploaded_at, created_at')).filter((r) => r.verification_status === 'pending');
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('uploaded_at', 'created_at'));
    },
  },
  {
    id: 'trust.trust_facts', plane: 'trust', label: 'Trust fact requests awaiting review', owner: 'Trust & Safety',
    source: 'trust_fact_requests (pending) · K2B (vehicle and owner)', operate: { route: '/admin/trust-review', label: 'Open trust review queue' },
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'trust_fact_requests', 'id, vin, status, created_at')).filter((r) => r.status === 'pending');
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'trust.fraud', plane: 'trust', label: 'Fraud cases open or investigating', owner: 'Trust & Safety',
    source: 'fraud_cases (open, investigating) · K2B (vehicle and owner)', operate: { route: '/admin/fraud-queue', label: 'Open fraud & duplicate queue' },
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'fraud_cases', 'id, vin, status, created_at')).filter((r) => ['open', 'investigating'].includes(r.status));
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'trust.governance_review', plane: 'trust', label: 'Governance review items', owner: 'Trust & Safety',
    source: 'temporal_findings + disclosure_conflicts (pending review) + vehicle_identity_candidates (pending) · K2B (vehicle)', operate: { route: '/admin/governance-review', label: 'Open governance review queue' },
    detail: 'Findings, disclosure conflicts and identity candidates. Pending evidence also appears in that surface but is counted once, in the evidence queue.',
    async read(ctx) {
      const [findings, conflicts, candidates] = await Promise.all([
        readAllRows(ctx.client, 'temporal_findings', 'id, vin, reviewer_state, created_at'),
        readAllRows(ctx.client, 'disclosure_conflicts', 'id, vin, reviewer_state, created_at'),
        readAllRows(ctx.client, 'vehicle_identity_candidates', 'id, candidate_vin, status, created_at'),
      ]);
      const rows = [
        ...findings.filter((r) => r.reviewer_state === 'pending_review').map((r) => ({ ...r, kind: 'temporal_finding' })),
        ...conflicts.filter((r) => r.reviewer_state === 'pending_review').map((r) => ({ ...r, kind: 'disclosure_conflict' })),
        ...candidates.filter((r) => r.status === 'pending').map((r) => ({ ...r, vin: r.candidate_vin, kind: 'identity_candidate' })),
      ];
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'trust.dealer_compliance', plane: 'trust', label: 'Dealer profiles in compliance review', owner: 'Compliance',
    source: 'dealer_profiles (compliance review in review) · K2B (dealer account)', operate: { route: '/admin/dealer-compliance', label: 'Open dealer compliance queue' },
    detail: 'Times are the profile\'s last change; no review-entry time is recorded.',
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'dealer_profiles', 'id, user_id, compliance_review_state, updated_at, created_at')).filter((r) => r.compliance_review_state === 'in_review');
      return k2bCount(await byPrincipal(ctx, rows, (r) => r.user_id), () => true, timeOf('updated_at', 'created_at'));
    },
  },
  {
    id: 'trust.partsentry', plane: 'trust', label: 'PartSentry review requests pending', owner: 'Parts & Provenance',
    source: 'partsentry_review_requests (pending) · K2B (vehicle and owner)', operate: null,
    detail: 'No operational surface serves this queue yet.',
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'partsentry_review_requests', 'id, vin, status, created_at')).filter((r) => r.status === 'pending');
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'trust.document_extractions', plane: 'trust', label: 'Document extractions awaiting review', owner: 'Trust & Safety',
    source: 'vehicle_document_extractions (review pending) · K2B (vehicle and owner)', operate: null,
    detail: 'Reviewed per vehicle; there is no global queue surface.',
    async read(ctx) {
      const rows = (await readAllRows(ctx.client, 'vehicle_document_extractions', 'id, vin, review_status, created_at')).filter((r) => r.review_status === 'pending');
      return k2bCount(await byVehicle(ctx, rows, (r) => r.vin), () => true, timeOf('created_at'));
    },
  },
  {
    id: 'trust.referral', plane: 'trust', label: 'Referral trust review cases and disputes open', owner: 'Growth & Referrals',
    source: 'referral_events (review cases open / in review; disputes open / under review)', operate: { route: '/admin/referrals/trust', label: 'Open referral trust review' },
    async read(ctx) {
      const rows = await readAllRows(ctx.client, 'referral_events', 'id, event_type, metadata, created_at', (q) => q.in('event_type', ['trust.review_case_created', 'trust.dispute_created']));
      const open = rows.filter((r) => {
        const status = r.metadata?.status;
        return r.event_type === 'trust.review_case_created' ? ['open', 'in_review'].includes(status) : ['open', 'under_review'].includes(status);
      });
      return {
        value: open.length,
        extent: extentOf(open.map((r) => r.created_at)),
        detail: 'Not provenance-filtered: these cases carry no principal K2B can judge.',
      };
    },
  },
]);

function attentionOf(fact) {
  if (fact.state !== 'TECHNICAL_OPERATIONAL') {
    return { state: 'unknown', rule: 'The source could not be read completely, so whether work is waiting is unknown.' };
  }
  if (fact.value > 0) {
    return { state: 'work_waiting', rule: 'Items are waiting for CarUp action. No governed target exists for this queue, so nothing is called late.' };
  }
  return { state: 'clear', rule: 'Nothing is waiting (complete read).' };
}

/**
 * @param opts.plane 'operations' | 'trust' | undefined (all)
 * @param opts.communications () => Promise<{ summary }> — the conversation truth (shared with the communications facts)
 */
export async function readQueueFacts(client, { now = new Date(), plane, ctx = createSourceContext(client, { now }), communications } = {}) {
  const context = { ...ctx, communications: communications ?? (async () => { throw new Error('communications source not provided'); }) };
  const selected = QUEUES.filter((q) => !plane || q.plane === plane);
  const queues = await Promise.all(selected.map(async (q) => {
    const fact = await readFact({
      id: q.id, label: q.label, kind: 'operational', source: { authority: q.source }, asOf: now,
      scope: q.id === 'trust.referral' ? 'Staging · all referral trust cases (not provenance-filtered)' : SCOPE_K2B,
      window: CURRENT_WINDOW, detail: q.detail ?? null,
    }, () => q.read(context), { now });
    return { id: q.id, plane: q.plane, label: q.label, owner: q.owner, operate: q.operate, fact, attention: attentionOf(fact) };
  }));
  return { queues };
}
