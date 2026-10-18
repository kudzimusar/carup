/**
 * CA-OWNER-02 (A, D) — Marketplace position and demand facts, read from the existing authoritative sources.
 *
 * Nothing here defines a new meaning. Every population reuses the definition the product already owns:
 *   · listings — the ONE Admin publication projection (deriveListingVisibility: status AND publication_status) over the
 *     K2B-classified listing base (readListingProvenanceBase), exactly as the moderation queue and analytics read it;
 *   · inquiries — K2B classifyInquiry (asker + the listing's class from that same base); "open" = the canonical inquiry
 *     statuses minus the terminal ones (closed, spam, rejected);
 *   · reservations — live = status active AND expires_at in the future (the reservation projection's own rule), judged by
 *     K2B through the inquiry each reservation rests on;
 *   · accounts, trade orders, logistics requests, service requests — K2B classifyIdentity of the record's principal;
 *   · searches — the rollup's own countable rule (computePlatformMetrics: excluded flags and self-traffic removed);
 *   · navigation — recorded route renders (navigation_destination_rendered), never users.
 *
 * K2B-filtered facts count operational records only and carry the summary of what was set aside; UNKNOWN is reported
 * apart and never counted. None of these is a certified Corporate Actual (OD-CAMETRIC-022). Accounts are not customers;
 * inquiries are not sales; no rate or conversion is computed here.
 */
import { readListingProvenanceBase, deriveListingVisibility } from '../../marketplace/marketplaceModerationService.js';
import { MARKETPLACE_INQUIRY_STATUSES } from '../../marketplace/marketplaceEventTypes.js';
import { classifyIdentity } from '../../provenance/recordProvenance.js';
import { createProvenanceIndex } from '../../provenance/provenanceContext.js';
import { computePlatformMetrics } from '../../intelligence/rollupService.js';
import { readFact, rollingWindow, CURRENT_WINDOW } from './managementFact.js';
import { exactCount, readAllRows, shared, provenanceOf, unknownProvenance, extentOf } from './sourceReads.js';

const TERMINAL_INQUIRY_STATUSES = new Set(['closed', 'spam', 'rejected']);
export const OPEN_INQUIRY_STATUSES = Object.freeze(MARKETPLACE_INQUIRY_STATUSES.filter((s) => !TERMINAL_INQUIRY_STATUSES.has(s)));
const TERMINAL_TRADE_ORDER_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const OPEN_SERVICE_CASE_STATUSES = new Set(['requested', 'accepted', 'active']);
const SEARCH_EVENT_TYPES = ['marketplace_search_performed', 'marketplace_search_zero_results'];

const SCOPE_K2B = 'Staging · all CarUp organisations · K2B-operational records only';

const inWindow = (time, window) => {
  const t = time ? new Date(time).getTime() : Number.NaN;
  return Number.isFinite(t) && t >= new Date(window.from).getTime() && t < new Date(window.to).getTime();
};

/**
 * @returns {Promise<{ facts: object[] }>} — never throws; a failed source degrades only the facts that rest on it.
 */
export async function readMarketplaceDemandFacts(client, { now = new Date(), windowDays = 7 } = {}) {
  const window = rollingWindow(windowDays, now);
  const asOf = now;

  // ── shared sources (read once, failing together) ───────────────────────────────────────────────────────────────────
  const listingBase = shared(async () => {
    const expected = await exactCount(client, 'vehicles', { column: 'vin' });
    const base = await readListingProvenanceBase(client);
    const provenanceByVin = new Map(base.classified.map((c) => [String(c.vehicle.vin), c.provenance]));
    return { ...base, provenanceByVin, complete: base.classified.length === expected };
  });
  const users = shared(async () => {
    const rows = await readAllRows(client, 'users', 'id, email, name');
    return { rows, index: createProvenanceIndex({ users: rows }) };
  });
  const inquiries = shared(async () => {
    const [base, people, rows] = await Promise.all([
      listingBase(),
      users(),
      readAllRows(client, 'marketplace_inquiries', 'id, buyer_id, guest_email, guest_name, listing_id, listing_type, status, created_at'),
    ]);
    const classified = rows.map((row) => ({ row, provenance: people.index.inquiry(row, base.provenanceByVin) }));
    return { classified, byId: new Map(classified.map((c) => [String(c.row.id), c])), complete: base.complete };
  });

  const k2b = (classified, keep = () => true, timeOf = () => null) => {
    const population = classified.filter(keep);
    const operational = population.filter((c) => c.provenance.operational);
    return {
      value: operational.length,
      provenance: provenanceOf(population.map((c) => c.provenance)),
      extent: extentOf(operational.map(timeOf)),
    };
  };
  const byPrincipal = (rows, principalOf) => users().then((people) => rows.map((row) => {
    const id = principalOf(row);
    return { row, provenance: id ? people.index.identity(id) : unknownProvenance('no_principal') };
  }));

  const spec = (id, label, authority, extra = {}) => ({ id, label, kind: 'operational', source: { authority }, asOf, scope: SCOPE_K2B, window: CURRENT_WINDOW, ...extra });
  const run = (s, reader) => readFact(s, reader, { now });

  const facts = await Promise.all([
    run(spec('marketplace.listing.public', 'Published Marketplace listings', 'vehicles · Admin publication projection (status AND publication_status) · K2B'), async () => {
      const base = await listingBase();
      if (!base.complete) return { complete: false };
      return k2b(base.classified, (c) => deriveListingVisibility(c.vehicle).public_status === 'public', (c) => c.vehicle.created_at);
    }),
    run(spec('marketplace.listing.pending_review', 'Listings awaiting moderation review', 'vehicles · Admin publication projection (pending review) · K2B', {
      detail: 'Oldest and newest are listing creation times; no moderation-entry time is recorded.',
    }), async () => {
      const base = await listingBase();
      if (!base.complete) return { complete: false };
      return k2b(base.classified, (c) => deriveListingVisibility(c.vehicle).public_status === 'pending_review', (c) => c.vehicle.created_at);
    }),
    run(spec('marketplace.inquiry.open', 'Open Marketplace inquiries', 'marketplace_inquiries · K2B (asker + listing)', {
      detail: `Status ${OPEN_INQUIRY_STATUSES.join(', ')}. An inquiry is not a sale.`,
    }), async () => {
      const inq = await inquiries();
      if (!inq.complete) return { complete: false };
      return k2b(inq.classified, (c) => OPEN_INQUIRY_STATUSES.includes(c.row.status), (c) => c.row.created_at);
    }),
    run(spec('marketplace.inquiry.recent', `Marketplace inquiries received (${windowDays} days)`, 'marketplace_inquiries · K2B (asker + listing)', { window }), async () => {
      const inq = await inquiries();
      if (!inq.complete) return { complete: false };
      return k2b(inq.classified, (c) => inWindow(c.row.created_at, window), (c) => c.row.created_at);
    }),
    run(spec('marketplace.reservation.active', 'Active vehicle reservations', 'vehicle_reservations (active, not expired) · K2B through its inquiry', {
      detail: 'A reservation is not a sale or a payment.',
    }), async () => {
      const [inq, rows] = await Promise.all([inquiries(), readAllRows(client, 'vehicle_reservations', 'id, vin, inquiry_id, status, expires_at, reserved_at')]);
      if (!inq.complete) return { complete: false };
      const live = rows.filter((r) => r.status === 'active' && r.expires_at && new Date(r.expires_at).getTime() > new Date(now).getTime());
      const classified = live.map((row) => ({ row, provenance: inq.byId.get(String(row.inquiry_id))?.provenance ?? unknownProvenance('reservation_inquiry_not_found') }));
      return k2b(classified, () => true, (c) => c.row.reserved_at);
    }),
    run(spec('growth.account.operational', 'Operational accounts (not customers)', 'users · K2B identity', {
      detail: 'An account is not a customer. Registered records that K2B sets aside (UAT, automation, certification) or cannot place are reported apart.',
    }), async () => {
      const people = await users();
      return k2b(people.rows.map((row) => ({ row, provenance: classifyIdentity(row) })));
    }),
    run(spec('growth.search.recorded', `Recorded searches (${windowDays} days)`, 'marketplace_activity_events · rollup countable rule', {
      window, scope: 'Staging · all recorded Marketplace sessions',
      detail: 'Staff, fixture, bot, synthetic and self-traffic events removed. Account provenance is not separable: most searches are anonymous.',
    }), async () => {
      const events = await readAllRows(client, 'marketplace_activity_events', 'id, event_type, exclusion_flags, occurred_at',
        (q) => q.in('event_type', SEARCH_EVENT_TYPES).gte('occurred_at', window.from).lt('occurred_at', window.to));
      return { value: computePlatformMetrics(events).searches };
    }),
    run(spec('growth.search.zero_result', `Searches with no results (${windowDays} days)`, 'marketplace_activity_events · rollup countable rule', {
      window, scope: 'Staging · all recorded Marketplace sessions',
      detail: 'Unmet recorded search demand — never a lost sale. Search terms are stored only as hashes and are not shown.',
    }), async () => {
      const events = await readAllRows(client, 'marketplace_activity_events', 'id, event_type, exclusion_flags, occurred_at',
        (q) => q.in('event_type', SEARCH_EVENT_TYPES).gte('occurred_at', window.from).lt('occurred_at', window.to));
      return { value: computePlatformMetrics(events).zero_result_searches };
    }),
    run(spec('growth.navigation.route_render', `Recorded route renders (${windowDays} days)`, 'navigation_analytics_events (navigation_destination_rendered)', {
      kind: 'technical', window, scope: 'Staging · all recorded navigation events',
      detail: 'Rendered routes, not users or customer journeys. Events carry no user or session, so provenance is not separable.',
    }), async () => ({
      value: await exactCount(client, 'navigation_analytics_events', {
        shape: (q) => q.eq('event_type', 'navigation_destination_rendered').gte('occurred_at', window.from).lt('occurred_at', window.to),
      }),
    })),
    run(spec('trade.order.open', 'Open trade (import) orders', 'diaspora_import_orders · K2B (buyer)', {
      detail: 'Not completed, not cancelled, not deleted.',
    }), async () => {
      const rows = (await readAllRows(client, 'diaspora_import_orders', 'id, buyer_id, created_by, status, created_at, deleted_at')).filter((r) => !r.deleted_at);
      return k2b(await byPrincipal(rows, (r) => r.buyer_id || r.created_by), (c) => !TERMINAL_TRADE_ORDER_STATUSES.has(c.row.status), (c) => c.row.created_at);
    }),
    run(spec('trade.order.recent', `Trade orders created (${windowDays} days)`, 'diaspora_import_orders · K2B (buyer)', { window }), async () => {
      const rows = (await readAllRows(client, 'diaspora_import_orders', 'id, buyer_id, created_by, status, created_at, deleted_at')).filter((r) => !r.deleted_at);
      return k2b(await byPrincipal(rows, (r) => r.buyer_id || r.created_by), (c) => inWindow(c.row.created_at, window), (c) => c.row.created_at);
    }),
    run(spec('trade.logistics.open_for_quotes', 'Logistics requests open for quotes', 'diaspora_logistics_requests · K2B (requester)'), async () => {
      const rows = await readAllRows(client, 'diaspora_logistics_requests', 'id, requester_id, status, created_at');
      return k2b(await byPrincipal(rows, (r) => r.requester_id), (c) => c.row.status === 'OPEN_FOR_QUOTES', (c) => c.row.created_at);
    }),
    run(spec('service.case.open', 'Open service requests', 'service_cases · K2B (requester)', {
      detail: 'Requested, accepted or active.',
    }), async () => {
      const rows = await readAllRows(client, 'service_cases', 'id, requester_user_id, status, requested_at, created_at');
      return k2b(await byPrincipal(rows, (r) => r.requester_user_id), (c) => OPEN_SERVICE_CASE_STATUSES.has(c.row.status), (c) => c.row.requested_at || c.row.created_at);
    }),
    run(spec('service.case.recent', `Service requests received (${windowDays} days)`, 'service_cases · K2B (requester)', { window }), async () => {
      const rows = await readAllRows(client, 'service_cases', 'id, requester_user_id, status, requested_at, created_at');
      return k2b(await byPrincipal(rows, (r) => r.requester_user_id), (c) => inWindow(c.row.requested_at || c.row.created_at, window), (c) => c.row.requested_at || c.row.created_at);
    }),
  ]);
  return { facts };
}
