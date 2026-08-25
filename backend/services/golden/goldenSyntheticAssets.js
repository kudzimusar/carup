/**
 * Issue #164 Phase 8 — deterministic synthetic assets for the Golden fixture (Cluster C).
 *
 * ## Why this exists
 *
 * Phase 7 seeded Golden A's five listing photos and four evidence documents as URLs on
 * `media.carup-staging.test` / `evidence.carup-staging.test`. `.test` is reserved by RFC 2606 and can
 * never resolve, so every image was broken on Landing, Marketplace, Detail and the owner garage, and
 * every evidence file was unopenable. The rows existed; the artifacts did not. The physical UAT saw
 * `ERR_NAME_NOT_RESOLVED`.
 *
 * The fix is to make the fixture produce REAL bytes and put them through the canonical storage
 * contract, so the locators resolve exactly like an owner's own upload. This module produces those
 * bytes.
 *
 * ## What these must and must not be
 *
 * They must be unmistakably synthetic. A stock photograph of a Toyota Hilux would make the fixture
 * *look* right while asserting something false about a vehicle that does not exist — the precise
 * failure mode Issue #164 exists to eliminate. So each image is a flat-toned diagonally-striped panel
 * that no one could mistake for a photograph, and each document is a plain-text PDF that states what
 * it is. Both additionally carry `SYNTHETIC_DOCUMENT_MARKER` in machine-readable metadata.
 *
 * Everything here is a pure function of (vin, facet). Same inputs, same bytes — so re-running the
 * bootstrap uploads an identical object to an identical path and changes nothing.
 */

import zlib from 'node:zlib';
import { SYNTHETIC_DOCUMENT_MARKER, GOLDEN_PROGRAMME } from './goldenVehicleSpecs.js';

const IMAGE_WIDTH = 960;
const IMAGE_HEIGHT = 640;

/** A small deterministic hash — used only to pick a stable colour per facet, never for security. */
function stableHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A muted, deterministic slate tone per (vin, facet). Deliberately unphotographic. */
function facetPalette(vin, facet) {
  const h = stableHash(`${vin}:${facet}`);
  // `>>>`, not `>>`. A signed shift on a hash above 2^31 yields a NEGATIVE number, and `negative % 60`
  // is negative in JS, which collapsed the accent onto the background and produced near-uniform
  // panels for exactly those facets.
  const base = 56 + (h % 40);             // dark slate background
  const accent = 132 + ((h >>> 8) % 60);  // lighter stripe
  return {
    bg: [base, base + 6, base + 14],
    stripe: [accent, accent + 4, accent + 12],
  };
}

// ── minimal PNG encoder (no dependency; Buffer + zlib only) ──────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** A PNG `tEXt` chunk — keyword\0value, latin1. Carries the synthetic markers into the file itself. */
function textChunk(keyword, value) {
  return pngChunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1'));
}

/**
 * Render one deterministic synthetic listing image as PNG bytes.
 *
 * The stripes run diagonally so the result reads instantly as a placeholder panel rather than a
 * photograph, and the per-facet tone makes the five Golden A images visibly distinct from one another
 * (so "the gallery shows five different photos" is observable in UAT without any of them being a
 * picture of a real vehicle).
 */
export function syntheticListingImagePng(vin, facet) {
  const { bg, stripe } = facetPalette(vin, facet);
  const bytesPerPixel = 3;
  const stride = IMAGE_WIDTH * bytesPerPixel + 1; // +1 filter byte per scanline
  const raw = Buffer.alloc(stride * IMAGE_HEIGHT);

  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < IMAGE_WIDTH; x += 1) {
      // 48px diagonal bands.
      const onStripe = (((x + y) >> 5) & 1) === 0;
      const [r, g, b] = onStripe ? stripe : bg;
      const p = rowStart + 1 + x * bytesPerPixel;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(IMAGE_WIDTH, 0);
  ihdr.writeUInt32BE(IMAGE_HEIGHT, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    textChunk('Title', `${SYNTHETIC_DOCUMENT_MARKER} listing media placeholder`),
    textChunk('Description', `Synthetic ${GOLDEN_PROGRAMME} fixture asset for ${vin} (${facet}). `
      + 'Not a photograph. Depicts no real vehicle.'),
    textChunk('Software', GOLDEN_PROGRAMME),
    // `deflateSync` at a fixed level is deterministic for identical input.
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── minimal PDF writer ───────────────────────────────────────────────────────

function pdfEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Render one deterministic synthetic evidence document as PDF bytes.
 *
 * Plain, uncompressed PDF 1.4 with a single page. It states on its face that it is synthetic, so an
 * operator who opens it from the evidence vault cannot mistake it for a real registry document.
 */
export function syntheticEvidenceDocumentPdf(vin, evidenceType) {
  const lines = [
    `${SYNTHETIC_DOCUMENT_MARKER}`,
    '',
    `Programme: ${GOLDEN_PROGRAMME}`,
    `Vehicle:   ${vin}`,
    `Document:  ${evidenceType}`,
    '',
    'This file is a synthetic fixture artifact generated for staging UAT.',
    'It is NOT a registry document, carries no authority, and describes no',
    'real vehicle, person or transaction. It exists so that the evidence',
    'locator resolves to real bytes through the canonical storage contract.',
  ];

  const content = [
    'BT', '/F1 13 Tf', '54 742 Td', '17 TL',
    ...lines.map((l) => `(${pdfEscape(l)}) Tj T*`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/**
 * Deterministic storage object paths.
 *
 * Shaped like the production upload path (`<VIN>/<name>.<ext>`, see the evidence route in
 * backend/routes/vehiclesRoutes.js) but without its random suffix: a fixture must land on the same
 * object every run so that re-bootstrapping overwrites rather than accumulates.
 */
export function listingImageStoragePath(vin, facet) {
  return `${vin.toUpperCase()}/golden-${facet}.png`;
}

export function evidenceStoragePath(vin, evidenceType) {
  return `${vin.toUpperCase()}/golden-${evidenceType}.pdf`;
}

export const LISTING_IMAGE_MIME = 'image/png';
export const EVIDENCE_DOCUMENT_MIME = 'application/pdf';

export default {
  syntheticListingImagePng,
  syntheticEvidenceDocumentPdf,
  listingImageStoragePath,
  evidenceStoragePath,
  LISTING_IMAGE_MIME,
  EVIDENCE_DOCUMENT_MIME,
};
