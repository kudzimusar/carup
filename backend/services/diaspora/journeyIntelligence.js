/**
 * Trade OS T11-CAP-09 — what the recorded observations let us say about a journey, and no more.
 *
 * A READ-ONLY derivation. It stores nothing, predicts nothing and decides nothing; every figure here is the
 * arithmetic of dates somebody RECORDED, and where there is nothing to derive it from the answer is absent —
 * never zero, which would be a claim.
 *
 *   · A number comes from an OBSERVED date or it does not exist. A planned departure and an estimated arrival
 *     are intentions, so they never become a transit time; an arrival is compared with the FIRST estimate, and
 *     only once there is an arrival, because an estimate is not an arrival.
 *   · Below a stated minimum the honest answer is "not enough data" — and that answer does not leak how many
 *     journeys exist.
 *   · A route statistic describes journeys that have ALREADY been completed. It is not a prediction for this one.
 *   · A route statistic is built only from the SAME organiser's own completed sailings. Another tenant's
 *     operational data is never read into it. (Aggregating across organisers is a policy decision for the
 *     Moderator, not something to do quietly.)
 *   · It counts SAILINGS, not shipments. Nine co-loaders on one container are one sailing: counting them as nine
 *     would present one voyage as a track record.
 *   · Only aggregates leave this module — no id, container, organiser, order, carrier, vessel or port.
 */
import { supabase } from '../../db/supabase.js';

const SHIPMENTS = 'diaspora_shipments';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The fewest separate completed sailings that make a route statistic. Stated to the reader, not hidden. */
export const MIN_SAILINGS = 5;

/**
 * Candidate rows are bounded. An organiser with more than this many completed sailings on one route has the
 * most recent of them counted; the cap can only make a statistic MORE conservative (fewer sailings), never
 * invent one.
 */
export const LANE_ROW_LIMIT = 500;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const at = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t; };
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The middle value, or the mean of the two middle values. Nothing in, nothing out — never zero. */
export function median(values) {
  const v = (values || []).filter(isNumber).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * What this journey's OWN recorded dates say. `dates` is the Journey's projection of the shipment's dates:
 * planned and estimated values are present in it and are deliberately ignored here.
 */
export function projectOwnMetrics(dates = {}, now = new Date()) {
  const departed = at(dates.observed_departure);
  const arrived = at(dates.observed_arrival);
  const clock = now instanceof Date ? now.getTime() : Date.parse(now);

  let transit;
  if (departed === null) {
    transit = { value: null, note: 'Not available: no departure has been recorded for this shipment.' };
  } else if (arrived !== null && arrived < departed) {
    transit = { value: null, note: 'Not available: the recorded departure and arrival disagree.' };
  } else if (arrived !== null) {
    transit = { value: Math.round((arrived - departed) / DAY_MS), ongoing: false, note: 'From the recorded departure to the recorded arrival.' };
  } else if (Number.isFinite(clock) && clock >= departed) {
    // Whole days, never rounded up: "so far" must not overstate how long it has been.
    transit = { value: Math.floor((clock - departed) / DAY_MS), ongoing: true, note: 'Whole days since the recorded departure. The shipment has not been recorded as arrived.' };
  } else {
    transit = { value: null, note: 'Not available: the recorded departure is in the future.' };
  }

  const first = at(dates.estimated_arrival);
  let versus;
  if (arrived === null) {
    versus = { value: null, note: 'Not available: the shipment has not arrived, and an estimate is not an arrival.' };
  } else if (first === null) {
    versus = { value: null, note: 'Not available: no first estimate is recorded to compare the arrival with.' };
  } else {
    versus = { value: Math.round((arrived - first) / DAY_MS), note: 'The recorded arrival against the shipment record’s first estimate. Positive means later than that estimate.' };
  }
  return { days_in_transit: transit, arrival_vs_first_estimate_days: versus };
}

const closed = (availability, note) => ({ availability, minimum_sailings: MIN_SAILINGS, note });

/**
 * The same organiser's completed sailings on the same route — aggregated, or "not enough data".
 *
 * One read. The rows are filtered in the database AND again here: the second filter is the one that matters if
 * the first is ever loosened, and it costs nothing.
 */
export async function projectLaneStatistics(client = supabase, shipment = {}, { minSailings = MIN_SAILINGS } = {}) {
  const from = clean(shipment.origin_port);
  const to = clean(shipment.destination_port);
  if (!from || !to) {
    return { availability: 'not_applicable', note: 'The shipment record does not name both ports, so there is no route to compare.' };
  }
  if (!shipment.tenant_id) {
    return { availability: 'not_applicable', note: 'No organiser is recorded for this shipment, so there is nothing to compare it with.' };
  }

  const { data } = await client.from(SHIPMENTS).select('*')
    .eq('tenant_id', shipment.tenant_id).eq('origin_port', from).eq('destination_port', to)
    .neq('id', shipment.id).is('deleted_at', null)
    .not('departure_date', 'is', null).not('actual_arrival_date', 'is', null)
    .order('actual_arrival_date', { ascending: false }).limit(LANE_ROW_LIMIT);

  const bySailing = new Map();
  for (const row of data || []) {
    if (row.deleted_at || String(row.tenant_id) !== String(shipment.tenant_id) || String(row.id) === String(shipment.id)) continue;
    if (clean(row.origin_port) !== from || clean(row.destination_port) !== to) continue;
    const left = at(row.departure_date);
    const arrived = at(row.actual_arrival_date);
    if (left === null || arrived === null || arrived < left) continue; // observed only; an impossible duration is not a journey
    const estimate = at(row.estimated_arrival_date);
    const sailing = row.container_id ? `c:${row.container_id}` : `s:${row.id}`;
    if (!bySailing.has(sailing)) bySailing.set(sailing, { durations: [], versus: [] });
    const entry = bySailing.get(sailing);
    entry.durations.push((arrived - left) / DAY_MS);
    if (estimate !== null) entry.versus.push((arrived - estimate) / DAY_MS);
  }

  if (bySailing.size < minSailings) {
    // Deliberately says nothing about HOW MANY: a count below the minimum is itself information about other journeys.
    return {
      ...closed('insufficient_data', `Not enough completed sailings by this organiser on this route to say how long they usually take. This is shown only once at least ${minSailings} separate sailings have been completed.`),
      minimum_sailings: minSailings,
    };
  }

  const transit = [...bySailing.values()].map((s) => median(s.durations));
  const versus = [...bySailing.values()].filter((s) => s.versus.length).map((s) => median(s.versus));
  return {
    availability: 'sufficient',
    minimum_sailings: minSailings,
    sailings: bySailing.size,
    transit_days: { median: Math.round(median(transit)), min: Math.round(Math.min(...transit)), max: Math.round(Math.max(...transit)) },
    arrival_vs_estimate_days: versus.length >= minSailings
      ? { availability: 'sufficient', median_days: Math.round(median(versus)) }
      : { availability: 'insufficient_data', note: 'Not enough of these sailings have a recorded first estimate to compare.' },
    note: 'These are this organiser’s completed sailings on this route. They describe journeys that have already been completed; this is not a prediction for your shipment.',
  };
}
