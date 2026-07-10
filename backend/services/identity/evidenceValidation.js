import crypto from 'crypto';

/**
 * Phase 7C Workstream C — deterministic, fail-closed evidence validation.
 *
 * These checks run on the raw uploaded bytes and catch the cheap, unambiguous
 * non-documents: blank/1x1/tiny images, non-image payloads, and duplicate
 * front/back/selfie. They CANNOT, on their own, tell a genuine photo of a cup
 * from a photo of an ID card — that requires a real vision/document-detection
 * model (deferred). Until that exists the system still fails closed: the
 * decision engine never auto-verifies (see verificationSessionService submit)
 * and an admin visually reviews the evidence via the secure preview. This layer
 * is defense-in-depth, not the sole gate.
 */

// A real document scan is many KB; blank or 1x1 captures are tiny.
export const MIN_IMAGE_BYTES = 2048;

const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isWebp = (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

/** Detect the image type from magic bytes; null if not a supported image. */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isPng(buffer)) return 'image/png';
  if (isWebp(buffer)) return 'image/webp';
  return null;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate the uploaded evidence buffers. Returns { valid, reasons, hashes }.
 * `reasons` is empty iff valid. `hashes` are SHA-256 of each decodable side
 * (suitable for storing as provenance / duplicate-detection records).
 */
export function validateEvidenceImages({ front, back, selfie } = {}) {
  const reasons = [];
  const hashes = {};
  const sides = { front, back, selfie };

  for (const [side, buf] of Object.entries(sides)) {
    if (buf === undefined || buf === null) continue;
    if (!Buffer.isBuffer(buf) || buf.length < MIN_IMAGE_BYTES) {
      reasons.push(`${side}: image is missing or too small to be a document.`);
      continue;
    }
    if (!detectImageType(buf)) {
      reasons.push(`${side}: not a supported/decodable image.`);
      continue;
    }
    hashes[side] = sha256(buf);
  }

  // Duplicate-evidence detection (a common fraud / mistaken-capture signal).
  if (hashes.front && hashes.back && hashes.front === hashes.back) {
    reasons.push('Front and back images are identical.');
  }
  if (hashes.selfie && hashes.front && hashes.selfie === hashes.front) {
    reasons.push('Selfie is identical to the front document image.');
  }
  if (hashes.selfie && hashes.back && hashes.selfie === hashes.back) {
    reasons.push('Selfie is identical to the back document image.');
  }

  return { valid: reasons.length === 0, reasons, hashes };
}
