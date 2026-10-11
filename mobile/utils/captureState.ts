export type CaptureStage =
  | 'CAPTURED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'OCR_READING'
  | 'OCR_EXTRACTED'
  | 'USER_CONFIRMED'
  | 'NEEDS_REVIEW'
  | 'UNDER_REVIEW'
  | 'DOMAIN_VERIFIED'
  | 'RETRY_REQUIRED'
  | 'REJECTED'
  | 'NETWORK_FAILED';

export type CaptureTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface CaptureStageMeta {
  label: string;
  description: string;
  tone: CaptureTone;
}

export const CAPTURE_STAGE_META: Record<CaptureStage, CaptureStageMeta> = {
  CAPTURED: {
    label: 'Photo captured',
    description: 'Review the photo before sending it.',
    tone: 'neutral',
  },
  UPLOADING: {
    label: 'Uploading',
    description: 'Sending your photo securely to CarUp.',
    tone: 'info',
  },
  UPLOADED: {
    label: 'Upload received',
    description: 'CarUp received the photo. This does not verify the document.',
    tone: 'info',
  },
  OCR_READING: {
    label: 'Reading the details',
    description: 'CarUp is extracting information so you do not have to type it.',
    tone: 'info',
  },
  OCR_EXTRACTED: {
    label: 'Details read',
    description: 'Check the extracted details before continuing.',
    tone: 'neutral',
  },
  USER_CONFIRMED: {
    label: 'Details confirmed',
    description: 'Your confirmation is recorded as input, not as independent proof.',
    tone: 'neutral',
  },
  NEEDS_REVIEW: {
    label: 'Needs review',
    description: 'CarUp could not confirm everything automatically.',
    tone: 'warning',
  },
  UNDER_REVIEW: {
    label: 'Under review',
    description: 'Your submitted evidence is being reviewed.',
    tone: 'neutral',
  },
  DOMAIN_VERIFIED: {
    label: 'Verified',
    description: 'The responsible CarUp authority accepted the submitted evidence.',
    tone: 'success',
  },
  RETRY_REQUIRED: {
    label: 'Retake required',
    description: 'A clearer or corrected capture is required before review can continue.',
    tone: 'warning',
  },
  REJECTED: {
    label: 'Not approved',
    description: 'The responsible CarUp authority did not accept this submission.',
    tone: 'danger',
  },
  NETWORK_FAILED: {
    label: 'Connection problem',
    description: 'The upload did not finish. Try again when your connection is available.',
    tone: 'danger',
  },
};

export function isTerminalCaptureStage(stage: CaptureStage): boolean {
  return stage === 'DOMAIN_VERIFIED' || stage === 'REJECTED';
}
