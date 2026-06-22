/**
 * Source provider interface — Milestone 2 (master plan §6.2).
 *
 * Every external-source adapter (auction, importer/shipping, inspection centre, dealer
 * marketplace, insurer/repair, government registry) implements this contract. The
 * ingestion engine (ingestionService.js) only ever talks to this interface, so new
 * providers plug in without schema or engine changes (master plan §6.3, exit gate).
 *
 * Required shape:
 *   id            string   stable adapter id (matches ingestion_jobs.adapter_id)
 *   sourceCode    string   evidence_sources.code this adapter ingests for
 *   mode          'fixture' | 'sandbox' | 'live'   honesty marker (master plan §2.6)
 *   async fetchPage(cursor)        -> { records: RawRecord[], nextCursor: string|null }
 *   mapRecord(raw)                 -> NormalizedRecord
 *   validateRecord(normalized)     -> { ok: boolean, errors: string[] }
 *   async downloadAsset(ref)       -> { buffer: Buffer|null, mimeType, supported, reason? }
 *
 * NormalizedRecord (engine-facing, framework-neutral):
 *   {
 *     source_record_id, record_type ('listing'|'evidence'|'event'),
 *     identity: { vin?, chassis_number?, plate_number?, engine_number?,
 *                 source_vehicle_id?, auction_lot?, make?, model?, year? },
 *     event_date?, evidence_class?, evidence_subtype?,
 *     odometer_value?, odometer_unit?,
 *     listing?: { url, title, description, price, currency, advertised_mileage,
 *                 mileage_unit, claimed_condition, claimed_accident_status, image_refs },
 *     assets?: [ { ref, mime_type, evidence_class, evidence_subtype } ]
 *   }
 */

export const PROVIDER_MODES = ['fixture', 'sandbox', 'live'];

const REQUIRED_METHODS = ['fetchPage', 'mapRecord', 'validateRecord', 'downloadAsset'];

/** Throws if a provider does not satisfy the interface. Used at registration time. */
export function assertProviderShape(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('provider must be an object');
  if (!provider.id) throw new Error('provider.id is required');
  if (!provider.sourceCode) throw new Error(`provider ${provider.id}: sourceCode is required`);
  if (!PROVIDER_MODES.includes(provider.mode)) {
    throw new Error(`provider ${provider.id}: mode must be one of ${PROVIDER_MODES.join('|')}`);
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof provider[m] !== 'function') {
      throw new Error(`provider ${provider.id}: missing method ${m}()`);
    }
  }
  return true;
}

/** Simple registry so the engine + routes can resolve adapters by id. */
const registry = new Map();

export function registerProvider(provider) {
  assertProviderShape(provider);
  registry.set(provider.id, provider);
  return provider;
}

export function getProvider(id) {
  return registry.get(id) || null;
}

export function listProviders() {
  return [...registry.values()].map((p) => ({ id: p.id, sourceCode: p.sourceCode, mode: p.mode }));
}

export default { PROVIDER_MODES, assertProviderShape, registerProvider, getProvider, listProviders };
