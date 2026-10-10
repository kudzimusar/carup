/**
 * OC-4C — the native garage odometer capture, on the governed vehicle-evidence path.
 *
 *   capture → durable offline queue (capture-first) → authenticated, idempotent evidence upload
 *     → governed vehicle-evidence OCR (Document Intelligence → Qwen on the OCR provider boundary)
 *     → a CANDIDATE reading → human review
 *
 * The reading is candidate evidence: it never changes the vehicle's mileage, and nothing here can.
 * The app never calls an AI gateway or a model for OCR; the server's OCR authority does that.
 * Contract pinned in shared/contracts/native-odometer-capture.contract.json.
 */
import { csrfFetch } from './csrfFetch';

export const ODOMETER_NATIVE_EVIDENCE_TYPE = 'odometer_reading';

/** Canonical evidence semantics for an odometer capture. Private until a governed publication decision. */
export const ODOMETER_UPLOAD_CONTRACT = Object.freeze({
  evidence_class: 'current_condition',
  evidence_subtype: 'odometer',
  visibility_level: 'private',
});

export type OdometerReadingOutcome =
  | { kind: 'candidate'; evidenceId: string; reading: number; unit: string | null }
  | { kind: 'not_read'; evidenceId: string }
  | { kind: 'ocr_unavailable'; evidenceId: string }
  | { kind: 'queued' };

export function odometerOcrUrl(baseUrl: string, vin: string, evidenceId: string): string {
  return `${baseUrl}/api/vehicles/${encodeURIComponent(vin)}/evidence/${encodeURIComponent(evidenceId)}/run-ocr`;
}

/**
 * Ask the server's vehicle-evidence OCR authority to read an UPLOADED capture. Any failure is an
 * honest 'ocr_unavailable' — the photo is already stored evidence and stays available for manual review.
 */
export async function requestOdometerReading(
  baseUrl: string,
  token: string | null,
  vin: string,
  evidenceId: string,
): Promise<OdometerReadingOutcome> {
  try {
    // PC01-J-R1: the OCR read is a mutating route, so it carries a session-bound CSRF token.
    const res = await csrfFetch(baseUrl, token, odometerOcrUrl(baseUrl, vin, evidenceId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-session-token': token } : {}) },
      body: '{}',
    });
    if (!res.ok) return { kind: 'ocr_unavailable', evidenceId };
    const data: any = await res.json().catch(() => ({}));
    const value = data?.reading?.odometer_reading;
    if (data?.reading?.status === 'candidate_pending_review' && Number.isInteger(value)) {
      return { kind: 'candidate', evidenceId, reading: value, unit: data.reading.odometer_unit ?? null };
    }
    return { kind: 'not_read', evidenceId };
  } catch {
    return { kind: 'ocr_unavailable', evidenceId };
  }
}

/** What the owner is told. Every sentence must be true of what actually happened. */
export function odometerOutcomeMessage(outcome: OdometerReadingOutcome): { title: string; body: string } {
  switch (outcome.kind) {
    case 'candidate':
      return {
        title: 'Odometer reading captured',
        body: `Read from your photo: ${outcome.reading.toLocaleString('en-US')}${outcome.unit ? ` ${outcome.unit}` : ''}. `
          + 'It is saved as evidence pending review and does not change your vehicle\'s recorded mileage.',
      };
    case 'not_read':
      return {
        title: 'Photo saved as evidence',
        body: 'The reading could not be extracted automatically. Your photo is stored as private evidence and will be reviewed manually.',
      };
    case 'ocr_unavailable':
      return {
        title: 'Photo saved as evidence',
        body: 'Automatic reading is unavailable right now. Your photo is stored as private evidence and will be reviewed manually.',
      };
    default:
      return {
        title: 'Saved on this device',
        body: 'Your odometer photo is saved on this device and will upload automatically, once, when you are back online.',
      };
  }
}
