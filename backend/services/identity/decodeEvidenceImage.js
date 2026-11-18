import sharp from 'sharp';
import { ValidationError } from '../../utils/errors.js';

const MAX_EVIDENCE_PIXELS = 16_000_000;

export async function validateDecodedEvidenceImage(buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_EVIDENCE_PIXELS, failOn: 'warning', sequentialRead: true });
    const { width, height, pages } = await image.metadata();
    if (!width || !height || width * height > MAX_EVIDENCE_PIXELS || (pages ?? 1) !== 1) throw new Error();
    await image.timeout({ seconds: 5 }).stats();
  } catch {
    throw new ValidationError('Verification evidence must be a readable single image within the size limits.');
  }
}
