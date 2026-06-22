/**
 * Perceptual hash abstraction — Milestone 1 (master plan §5.3 / §5.4).
 *
 * Provides a near-duplicate-detection foundation that COMPLEMENTS (does not replace)
 * the existing SHA-256 cryptographic checksum. The cryptographic checksum catches
 * byte-identical re-uploads; the perceptual hash catches visually-similar images
 * (re-compressed / cropped / re-saved) for the M2/M3 image-reuse and same-vehicle work.
 *
 * Honest capability statement (master plan §2.6 — no fabricated capability):
 *   * PNG is decoded with the available `pngjs` library and a real dHash is computed.
 *   * Other formats (JPEG, WEBP, PDF) require an image decoder that is NOT currently a
 *     project dependency. For those we return `{ supported:false }` rather than a fake
 *     hash. Adding a decoder later (e.g. sharp/jimp) only requires extending
 *     `decodeToGray()` — the abstraction and its consumers do not change.
 *
 * Algorithm: dHash. Resize to 9x8 grayscale, compare horizontally-adjacent pixels
 * (8 comparisons/row x 8 rows = 64 bits), emit as 16-char hex.
 */

import { createRequire } from 'module';

const HASH_WIDTH = 9; // 9 columns -> 8 horizontal comparisons
const HASH_HEIGHT = 8;

// Lazily load pngjs (a CommonJS dep) without top-level await so this module's
// import graph stays synchronous. Cached after first resolution.
const require = createRequire(import.meta.url);
let PNG; // undefined = not yet attempted; null = unavailable
function getPng() {
  if (PNG !== undefined) return PNG;
  try {
    const mod = require('pngjs');
    PNG = mod.PNG || (mod.default && mod.default.PNG) || null;
  } catch {
    PNG = null;
  }
  return PNG;
}

function isPng(buffer, mimeType) {
  if (mimeType && /png/i.test(mimeType)) return true;
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  return (
    buffer &&
    buffer.length > 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  );
}

/**
 * Decode a supported image buffer into a grayscale matrix at HASH_WIDTH x HASH_HEIGHT.
 * Returns null when the format is unsupported by available decoders.
 */
function decodeToGray(buffer, mimeType) {
  const png = getPng();
  if (!png || !isPng(buffer, mimeType)) return null;
  let img;
  try {
    img = png.sync.read(buffer);
  } catch {
    return null;
  }
  const { width, height, data } = img; // data is RGBA
  if (!width || !height) return null;

  const out = [];
  for (let ry = 0; ry < HASH_HEIGHT; ry += 1) {
    const row = [];
    for (let rx = 0; rx < HASH_WIDTH; rx += 1) {
      // Nearest-neighbour sample (sufficient + dependency-free for a 9x8 fingerprint).
      const sx = Math.min(width - 1, Math.floor((rx * width) / HASH_WIDTH));
      const sy = Math.min(height - 1, Math.floor((ry * height) / HASH_HEIGHT));
      const idx = (sy * width + sx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Rec. 601 luma
      row.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
    out.push(row);
  }
  return out;
}

function grayToDHashHex(gray) {
  let bits = '';
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      bits += gray[y][x] < gray[y][x + 1] ? '1' : '0';
    }
  }
  // 64 bits -> 16 hex chars
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Compute a perceptual hash for an image buffer.
 * @returns {{ supported: boolean, algorithm: string, hash: string|null, reason?: string }}
 */
export function computePerceptualHash(buffer, mimeType) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { supported: false, algorithm: 'dhash', hash: null, reason: 'no_buffer' };
  }
  const gray = decodeToGray(buffer, mimeType);
  if (!gray) {
    return {
      supported: false,
      algorithm: 'dhash',
      hash: null,
      reason: getPng() ? 'unsupported_format' : 'decoder_unavailable',
    };
  }
  return { supported: true, algorithm: 'dhash', hash: grayToDHashHex(gray) };
}

/** Hamming distance between two equal-length hex hashes (number of differing bits). */
export function hammingDistance(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hexA.length; i += 1) {
    let xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * Whether two perceptual hashes are near-duplicates.
 * Default threshold of 10 bits / 64 is a conservative starting point; the M3
 * similarity work tunes this against the evaluation set (master plan §7.6).
 */
export function isNearDuplicate(hexA, hexB, threshold = 10) {
  return hammingDistance(hexA, hexB) <= threshold;
}

export default { computePerceptualHash, hammingDistance, isNearDuplicate };
