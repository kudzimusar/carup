/**
 * Sandbox Japanese-auction adapter — Milestone 2 (master plan §6.3).
 *
 * A CONTRACT-COMPLETE, FIXTURE-BACKED provider. It implements the full sourceProvider
 * interface so the ingestion engine exercises the real code path, but it reads synthetic
 * fixtures — there is NO live auction API and NO credentials. `mode: 'fixture'` makes that
 * explicit; this source must never be represented as live (master plan §2.6).
 *
 * To promote to live: implement fetchPage/downloadAsset against the real API behind
 * configured credentials, keep mapRecord/validateRecord, and flip mode to 'live' only
 * after contract verification. See SOURCE_PARTNER_ONBOARDING.md.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'jp_auction_sandbox.json');

function loadFixtures() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
}

function isValidIsoDate(s) {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s);
}

export const sandboxJpAuctionAdapter = {
  id: 'sandbox_jp_auction',
  sourceCode: 'jp_auction_sandbox',
  mode: 'fixture',

  async fetchPage(cursor) {
    const fixtures = loadFixtures();
    const pages = fixtures.pages || [];
    const idx = cursor ? pages.findIndex((p, i) => `page-${i + 1}` === cursor) : 0;
    const page = pages[idx >= 0 ? idx : 0] || { records: [], nextCursor: null };
    return { records: page.records || [], nextCursor: page.nextCursor || null };
  },

  mapRecord(raw) {
    return {
      source_record_id: raw.lot,
      record_type: (raw.images && raw.images.length) ? 'evidence' : 'event',
      identity: {
        vin: raw.vin || null,
        chassis_number: raw.chassis || null,
        auction_lot: raw.lot || null,
        make: raw.make || null,
        model: raw.model || null,
        year: raw.year || null,
      },
      event_date: isValidIsoDate(raw.auction_date) ? raw.auction_date.slice(0, 10) : null,
      evidence_class: 'auction',
      evidence_subtype: 'auction_image',
      odometer_value: typeof raw.odometer_km === 'number' ? raw.odometer_km : null,
      odometer_unit: typeof raw.odometer_km === 'number' ? 'km' : null,
      assets: (raw.images || []).map((img) => ({
        ref: img.ref,
        mime_type: 'image/png',
        evidence_class: 'auction',
        evidence_subtype: 'auction_image',
        legacy_evidence_type: 'auction_photo',
      })),
      _raw_grade: raw.grade || null,
    };
  },

  validateRecord(normalized) {
    const errors = [];
    if (!normalized.source_record_id) errors.push('missing source_record_id');
    const id = normalized.identity || {};
    if (!id.vin && !id.chassis_number && !(id.make && id.model && id.year)) {
      errors.push('insufficient identity (need vin/chassis or make+model+year)');
    }
    if (!normalized.event_date) errors.push('missing/invalid event_date');
    return { ok: errors.length === 0, errors };
  },

  async downloadAsset(ref) {
    // Sandbox: synthesize a tiny deterministic PNG-ish buffer keyed on the ref so checksums
    // are stable and unique. No network call. Real adapters fetch via signed URL here.
    if (!ref) return { buffer: null, mimeType: 'image/png', supported: false, reason: 'no_ref' };
    const seed = crypto.createHash('sha256').update(ref).digest();
    // Minimal valid PNG header + seeded bytes (enough for checksum; perceptual hash will
    // report unsupported for this stub, which is the honest result).
    const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), seed]);
    return { buffer, mimeType: 'image/png', supported: true };
  },
};

export default sandboxJpAuctionAdapter;
