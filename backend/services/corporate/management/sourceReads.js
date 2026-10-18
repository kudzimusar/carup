/**
 * CA-OWNER-02 — how a Corporate read model reads a source: completely, or not at all.
 *
 *   · `readAllRows` pages through every matching row (ordered, so pages are stable) and THROWS on any error or overflow —
 *     never the first 1000 rows presented as the whole;
 *   · `exactCount` asks the database for an exact count without reading rows (a windowed or filtered count);
 *   · `shared` runs one source load once per request, so several facts that rest on the same rows read them once and
 *     fail together;
 *   · `provenanceOf` is the K2B summary every K2B-filtered fact carries (raw / operational / excluded / unknown / by class).
 */
import { readAllPages } from '../../intelligence/rollupService.js';
import { summarizeProvenance, UNKNOWN } from '../../provenance/recordProvenance.js';

export const K2B_AUTHORITY = 'PC01-K2B operational-provenance authority';

/** Every row matching the query, page by page. Throws on any read error or on overflow. */
export async function readAllRows(client, table, columns, shape = (q) => q, { orderBy = 'id' } = {}) {
  return readAllPages(() => shape(client.from(table).select(columns)).order(orderBy));
}

/** An exact row count, read without rows. Throws on error or when the database does not return a count. */
export async function exactCount(client, table, { column = 'id', shape = (q) => q } = {}) {
  const { count, error } = await shape(client.from(table).select(column, { count: 'exact', head: true }));
  if (error) throw new Error(`count failed for ${table}`);
  if (typeof count !== 'number' || !Number.isFinite(count)) throw new Error(`no count returned for ${table}`);
  return count;
}

/** Run `load` at most once; every caller shares the same promise (and the same failure). */
export function shared(load) {
  let promise = null;
  return () => {
    promise ||= Promise.resolve().then(load);
    return promise;
  };
}

/** The K2B summary carried by a K2B-filtered fact. */
export function provenanceOf(results) {
  return { authority: K2B_AUTHORITY, ...summarizeProvenance(results) };
}

/** A K2B-shaped "needs review" result for a record whose own principal could not be resolved. */
export function unknownProvenance(rule) {
  return Object.freeze({ class: UNKNOWN, operational: false, confidence: 'none', rule, signals: Object.freeze([rule]) });
}

/** Oldest and newest of a list of timestamps (ISO strings or Dates); nulls ignored. */
export function extentOf(times) {
  const ms = (times || []).map((t) => (t ? new Date(t).getTime() : Number.NaN)).filter((t) => Number.isFinite(t));
  if (!ms.length) return { oldestAt: null, newestAt: null };
  return { oldestAt: new Date(Math.min(...ms)), newestAt: new Date(Math.max(...ms)) };
}
