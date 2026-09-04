/**
 * Document payload decoding and HONEST media observation.
 *
 * Everything reported here is read out of the bytes themselves. What CarUp does not measure —
 * blur, glare, tamper suspicion — is reported as `not_measured`, never estimated. The previous
 * implementation derived those three scores from an MD5 hash of the payload and presented them
 * as measurements, which drove real 'Poor_Image_Quality' and 'Suspected_Tampering' verdicts on
 * documents no one had looked at.
 */

export const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
]);

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export class UnsupportedDocumentMediaError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'UnsupportedDocumentMediaError';
    this.ocrStatus = 'Pending_Manual_Review';
    this.qualityIssue = detail;
  }
}

function sniffMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')) return 'image/heic';
    if (brand.startsWith('mif1') || brand.startsWith('msf1')) return 'image/heif';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { widthPx: buffer.readUInt32BE(16), heightPx: buffer.readUInt32BE(20) };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (JPEG_SOF_MARKERS.has(marker)) {
      return { heightPx: buffer.readUInt16BE(offset + 5), widthPx: buffer.readUInt16BE(offset + 7) };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function observeDimensions(mimeType, buffer) {
  try {
    if (mimeType === 'image/png') return pngDimensions(buffer);
    if (mimeType === 'image/jpeg') return jpegDimensions(buffer);
  } catch {
    return null;
  }
  return null; // WEBP/HEIC/PDF dimensions are not read; they are reported as unknown, not guessed.
}

/**
 * Turns whatever the caller supplied — a data URI or bare base64 — into real bytes plus the media
 * facts that can actually be read from them. Throws UnsupportedDocumentMediaError when the payload
 * is empty or is not a document format the vision provider accepts, so the caller never ships
 * bytes it cannot name.
 */
export function decodeDocumentPayload(payload) {
  if (typeof payload !== 'string' || !payload.trim()) {
    throw new UnsupportedDocumentMediaError('No document payload was supplied for extraction.', 'empty_payload');
  }

  let declaredMime = null;
  let base64 = payload.trim();
  const dataUri = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(base64);
  if (dataUri) {
    declaredMime = dataUri[1].toLowerCase();
    base64 = dataUri[3];
  }
  base64 = base64.replace(/\s/g, '');

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new UnsupportedDocumentMediaError('The document payload decoded to zero bytes.', 'empty_payload');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new UnsupportedDocumentMediaError('The document payload exceeds the 15MB extraction limit.', 'payload_too_large');
  }

  const sniffed = sniffMimeType(buffer);
  const mimeType = sniffed || (SUPPORTED_MIME_TYPES.has(declaredMime) ? declaredMime : null);
  if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedDocumentMediaError(
      'The uploaded file is not a document format the extraction provider can read.',
      'unsupported_media_type',
    );
  }

  return {
    buffer,
    base64: buffer.toString('base64'),
    mimeType,
    declaredMimeType: declaredMime,
    byteSize: buffer.length,
    dimensions: observeDimensions(mimeType, buffer),
  };
}

const NOT_MEASURED = 'not_measured';

const QUALITY_NOTE =
  'CarUp does not measure blur, glare or tamper suspicion. These are reported as not measured '
  + 'rather than estimated, so no reviewer or automated step can act on a number no one produced.';

/**
 * The honest quality envelope. `measured` is false because no image-quality measurement is
 * performed; the media facts alongside it were read from the file header. The three score keys
 * are retained as explicit nulls so existing readers see an absence rather than a stale number.
 */
export function describeMediaQuality(media, qualityIssues = []) {
  return {
    measured: false,
    blur: NOT_MEASURED,
    glare: NOT_MEASURED,
    tamperSuspicion: NOT_MEASURED,
    blurScore: null,
    glareScore: null,
    tamperSuspicionScore: null,
    qualityPassed: null,
    note: QUALITY_NOTE,
    media: media
      ? {
        mimeType: media.mimeType,
        byteSize: media.byteSize,
        widthPx: media.dimensions?.widthPx ?? null,
        heightPx: media.dimensions?.heightPx ?? null,
      }
      : null,
    qualityIssues: [...qualityIssues],
  };
}
