/**
 * Trade OS T6.1 — REFERENCE foreign-exchange authority.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE RESEARCH AND DECISION
 *
 * Source: the European Central Bank euro foreign exchange REFERENCE rates,
 *   https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 *
 * Why this source, and not an aggregator:
 *   · It is a central bank — an official monetary authority publishing its own figures — rather
 *     than a reseller whose API happens to be convenient.
 *   · The ECB itself publishes these as REFERENCE rates "for information purposes" and states they
 *     are not intended for transaction purposes. That is precisely the semantic T6 needs: they are
 *     suitable for comparison and display, and unsuitable for settlement (T13) or customs
 *     valuation (T12). Choosing a source whose own terms match our contract is the point.
 *   · Free, keyless, stable URL, no licence negotiation for reference display.
 *
 * Coverage (verified live against the feed, 2026-09-06): 29 currencies quoted against EUR —
 *   USD, JPY, CZK, DKK, GBP, HUF, PLN, RON, SEK, CHF, ISK, NOK, TRY, AUD, BRL, CAD, CNY, HKD,
 *   IDR, ILS, INR, KRW, MXN, MYR, NZD, PHP, SGD, THB, ZAR.
 *
 * The limitation that matters most to CarUp, stated plainly:
 *   ZWG/ZWL (Zimbabwe), MZN (Mozambique) and TZS (Tanzania) are NOT published by the ECB — the
 *   destination market and two gateway markets. Conversions involving them are UNAVAILABLE. They
 *   are not approximated, not pegged, and not filled from a secondary source: an invented
 *   Zimbabwe rate would be worse than no rate at all, because someone would act on it.
 *
 * Publication frequency and effective-date semantics:
 *   Published once per TARGET business day, around 16:00 CET, and dated for that day. There is no
 *   weekend or holiday publication, so on a Sunday the newest available rate is Friday's. That is
 *   STALE, not "current" — and it is shown with its own effective date rather than today's.
 *
 * Triangulation:
 *   The feed is EUR-based, so JPY→USD is not published. It is derived as JPY→EUR→USD and the legs
 *   are STORED, so the number can always be explained. An unexplained JPY/USD figure would be a
 *   magic number, which is exactly what this module exists to prevent.
 *
 * Revision and outage behaviour:
 *   The ECB may republish a corrected rate for a date. Snapshots are immutable, so a correction
 *   arrives as a NEW row and never rewrites a conversion a customer already saw. On outage or a
 *   malformed response the provider returns nothing; the caller degrades the USD comparison and
 *   keeps the source money. Never 0, never 1:1, never a silent last-known rate.
 *
 * Refresh, cache and observation policy (OC-5R-PROV-01 C1):
 *   · The source is OBSERVED, not fetched per read. One provider per process remembers its last
 *     successful feed for ECB_FEED_TTL_MS and an outage for ECB_FAILURE_TTL_MS, so a page that
 *     converts twenty charge components makes at most one request, and an outage is not re-probed
 *     on every read. Every request is bounded by ECB_FETCH_TIMEOUT_MS — a hung source degrades to
 *     UNAVAILABLE instead of holding the customer's request open.
 *   · A snapshot is WRITTEN only when the source has published a rate date NEWER than the newest
 *     stored one for that pair (the first observation included). A read that finds the same
 *     publication already stored writes nothing. One row per pair per ECB publication.
 *   · A snapshot dated today cannot be superseded, so it is served without consulting the source.
 *   · AVAILABLE vs STALE is computed when the rate is READ, from the age of the rate's own date —
 *     not frozen at the moment the row was written.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ValidationError } from '../../utils/errors.js';
import { resolveClient } from './diasporaServiceUtils.js';

const SNAPSHOTS = 'diaspora_fx_rate_snapshots';
const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** A rate older than this many days is reported STALE rather than presented as current. */
export const STALENESS_DAYS = 4;
/** One source request may take at most this long; past it the read degrades to UNAVAILABLE. */
export const ECB_FETCH_TIMEOUT_MS = 5000;
/** A successful observation of the feed is reused for this long. */
export const ECB_FEED_TTL_MS = 30 * 60 * 1000;
/** An outage is remembered for this long, so it is not re-probed on every read. */
export const ECB_FAILURE_TTL_MS = 60 * 1000;

export const FX_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
});

const isCode = (c) => /^[A-Z]{3}$/.test(String(c || ''));
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * FxRateProvider — the abstraction commercial records depend on. Nothing in T6 references the ECB
 * directly, so a second official source can be added later without touching a single stored fact.
 *
 * A provider returns { base: 'EUR', rateDate: 'YYYY-MM-DD', rates: { USD: n, JPY: n, … } } or null.
 */
export function createEcbFxProvider({
  fetchImpl = globalThis.fetch,
  url = ECB_DAILY_URL,
  timeoutMs = ECB_FETCH_TIMEOUT_MS,
  ttlMs = ECB_FEED_TTL_MS,
  failureTtlMs = ECB_FAILURE_TTL_MS,
  clock = () => Date.now(),
} = {}) {
  let memo = null;                          // { at, feed } — the last observation, success or outage
  let inflight = null;                      // concurrent readers share one request

  async function observe() {
    let xml;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res || !res.ok) return null;
      xml = await res.text();
    } catch {
      return null;                          // outage or timeout: no rate, not a guessed rate
    }
    const dateMatch = /time='(\d{4}-\d{2}-\d{2})'/.exec(xml || '');
    if (!dateMatch) return null;            // malformed: refuse rather than parse hopefully
    const rates = {};
    for (const m of String(xml).matchAll(/currency='([A-Z]{3})'\s+rate='([0-9.]+)'/g)) {
      const value = Number(m[2]);
      if (Number.isFinite(value) && value > 0) rates[m[1]] = value;
    }
    if (!Object.keys(rates).length) return null;
    return { base: 'EUR', rateDate: dateMatch[1], rates };
  }

  return {
    name: 'ECB',
    reference: url,
    async fetchDaily() {
      if (memo && clock() - memo.at < (memo.feed ? ttlMs : failureTtlMs)) return memo.feed;
      if (!inflight) {
        inflight = observe()
          .then((feed) => { memo = { at: clock(), feed }; return feed; })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
  };
}

// The process-wide observer every read shares unless a caller injects its own provider.
let sharedProvider = null;
function sharedEcbProvider() {
  if (!sharedProvider) sharedProvider = createEcbFxProvider();
  return sharedProvider;
}

/**
 * Derive `base → quote` from a EUR-based feed, keeping the legs that produced it.
 * Returns null when either currency is unpublished — an unsupported currency is UNAVAILABLE.
 */
export function deriveRate(feed, base, quote) {
  if (!feed || !isCode(base) || !isCode(quote)) return null;
  if (base === quote) return { rate: 1, triangulation: null };
  const eurTo = (code) => (code === feed.base ? 1 : feed.rates[code]);
  const from = eurTo(base);
  const to = eurTo(quote);
  if (!(from > 0) || !(to > 0)) return null;
  // 1 base = (1/EURbase) EUR = (1/EURbase) * EURquote quote
  const rate = to / from;
  const legs = [];
  if (base !== feed.base) legs.push({ pair: `${feed.base}/${base}`, rate: from });
  if (quote !== feed.base) legs.push({ pair: `${feed.base}/${quote}`, rate: to });
  return { rate, triangulation: legs.length > 1 ? { via: feed.base, legs } : null };
}

/** Read the newest stored snapshot for a pair, if any. */
async function newestSnapshot(client, base, quote) {
  const { data } = await client.from(SNAPSHOTS).select('*')
    .eq('base_currency', base).eq('quote_currency', quote)
    .order('rate_date', { ascending: false }).limit(1);
  return (data || [])[0] || null;
}

/** Present a stored snapshot. Its status is decided NOW, from the age of its own rate date. */
function fromSnapshot(row, today, { unreachable = false } = {}) {
  const stale = dayDiff(today, row.rate_date) > STALENESS_DAYS;
  const out = {
    status: stale ? FX_STATUS.STALE : FX_STATUS.AVAILABLE,
    rate: Number(row.rate), rate_date: row.rate_date, source: row.source,
    source_reference: row.source_reference || null,
    triangulation: row.triangulation || null, snapshot_id: row.id,
  };
  if (stale) {
    out.reason = unreachable
      ? 'The rate source could not be reached; showing the last published rate with its own date.'
      : `The newest ${row.source} publication for this pair is dated ${row.rate_date}.`;
  }
  return out;
}

/**
 * Get a reference rate for display.
 *
 * Returns { status, rate, rate_date, source, triangulation, snapshot_id } — and on
 * UNAVAILABLE returns a reason instead of a number. It NEVER returns 0, 1, or a fabricated rate.
 */
export async function getReferenceRate(base, quote, options = {}) {
  const client = await resolveClient(options);
  const provider = options.provider
    || (options.providerOptions ? createEcbFxProvider(options.providerOptions) : sharedEcbProvider());
  const today = options.today || new Date().toISOString().slice(0, 10);

  if (!isCode(base) || !isCode(quote)) {
    return { status: FX_STATUS.UNAVAILABLE, reason: 'Currency codes must be ISO 4217 (three letters).' };
  }
  if (base === quote) {
    return { status: FX_STATUS.AVAILABLE, rate: 1, rate_date: today, source: 'identity', triangulation: null };
  }

  // Prefer a stored snapshot; it is what makes an already-displayed conversion reproducible. One
  // dated today cannot be superseded by a newer publication, so the source is not consulted.
  const existing = await newestSnapshot(client, base, quote);
  if (existing && existing.rate_date >= today) return fromSnapshot(existing, today);

  // Otherwise observe the source (at most once per provider TTL, bounded by the fetch timeout).
  const feed = await provider.fetchDaily();
  if (!feed) {
    // Outage. If we hold an older snapshot we may still show it — with its own effective date and
    // a status decided by its age. What we must never do is present it as today's rate.
    if (existing) return fromSnapshot(existing, today, { unreachable: true });
    return { status: FX_STATUS.UNAVAILABLE, reason: 'The reference rate source could not be reached.' };
  }

  const derived = deriveRate(feed, base, quote);
  if (!derived) {
    if (existing) return fromSnapshot(existing, today);
    return {
      status: FX_STATUS.UNAVAILABLE,
      reason: `${base}/${quote} is not published by ${provider.name}. No comparison is shown rather than an approximated one.`,
    };
  }

  // The source has published nothing newer than what is stored: write nothing.
  if (existing && existing.rate_date >= feed.rateDate) return fromSnapshot(existing, today);

  const row = {
    base_currency: base, quote_currency: quote,
    rate: Number(derived.rate.toFixed(10)), rate_date: feed.rateDate,
    source: provider.name, source_reference: provider.reference,
    status: dayDiff(today, feed.rateDate) > STALENESS_DAYS ? FX_STATUS.STALE : FX_STATUS.AVAILABLE,
    triangulation: derived.triangulation,
  };
  // Two readers observing the same new publication at once collide on the unique index; the row
  // that won is authoritative because it is the one a customer may already have seen.
  const { data, error } = await client.from(SNAPSHOTS).insert(row).select().single();
  if (error) {
    const again = await newestSnapshot(client, base, quote);
    if (again) return fromSnapshot(again, today);
    return { status: FX_STATUS.UNAVAILABLE, reason: 'The reference rate could not be recorded.' };
  }
  return fromSnapshot(data, today);
}

/**
 * Present a source amount alongside its reference conversion.
 *
 * The source money is ALWAYS returned. `reference` is null when no rate is available — the caller
 * then shows "USD comparison unavailable", never 0 and never the source number relabelled as USD.
 */
export async function toReferenceUsd(amount, currency, options = {}) {
  const source = { amount: amount === null || amount === undefined ? null : Number(amount), currency: currency || null };
  if (source.amount === null || !isCode(source.currency)) {
    return { source, reference: null, fx: { status: FX_STATUS.UNAVAILABLE, reason: 'No source amount and currency to convert.' } };
  }
  const fx = await getReferenceRate(source.currency, 'USD', options);
  if (fx.status === FX_STATUS.UNAVAILABLE) return { source, reference: null, fx };
  return {
    source,
    reference: { amount: Number((source.amount * fx.rate).toFixed(2)), currency: 'USD' },
    fx,
  };
}

/** Guard: reference FX may never be presented as settlement or customs FX. */
export function assertReferenceOnly(purpose) {
  if (['SETTLEMENT', 'CUSTOMS'].includes(String(purpose || '').toUpperCase())) {
    throw new ValidationError(
      'Reference FX cannot be used for settlement or customs valuation. Settlement FX belongs to T13 and customs FX to T12.',
    );
  }
  return true;
}
