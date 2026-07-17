/**
 * Evidence CAPTURE-ADMISSION policy (native) — Workstream G / Full Activation mobile certification.
 *
 * The durable upload queue (mobile/store/uploadQueueStore.ts) certifies everything AFTER a capture
 * is admitted. This module is the gate BEFORE enqueue: it decides whether a freshly captured file
 * is an acceptable piece of evidence (supported format, within the per-file size budget) and it
 * provides the deterministic multi-page ordering used when a document is captured page-by-page.
 *
 * It is a pure, dependency-free function of its inputs (no React Native, no I/O), so the
 * certification harness can exercise the capture gate under `npx tsx` without a device. The
 * capture screen (mobile/app/(tabs)/garage.tsx) calls `evaluateCapture()` and only enqueues when
 * `accepted` is true — the wiring snippet is provided in the agent RETURN (this file is NEW and
 * does not itself edit the capture screen).
 *
 * HONEST SCOPE: this proves the admission LOGIC. Real camera/file-picker MIME reporting, HEIC
 * decoding and on-device thumbnailing can only be validated on a device/simulator.
 */

/**
 * Formats the native evidence workflow accepts. Photos (odometer, damage, plates) and scanned
 * documents (registration, insurance) — the same set the backend evidence pipeline can OCR/analyze.
 */
export const SUPPORTED_EVIDENCE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

/** Per-file ceiling. A single capture larger than this is rejected at the gate (not queued). */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024; // 25 MB

/** Minimum plausible size — a zero/near-zero byte "capture" is a failed/aborted capture, reject it. */
export const MIN_EVIDENCE_BYTES = 32;

export type CaptureRejectReason =
  | 'unsupported_format'
  | 'too_large'
  | 'empty_capture'
  | 'missing_mime';

export interface CaptureDescriptor {
  mimeType?: string | null;
  byteSize?: number | null;
  fileName?: string | null;
}

export interface CaptureDecision {
  accepted: boolean;
  reason: CaptureRejectReason | null;
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** Best-effort MIME from a file name extension (camera/file-picker sometimes omit the MIME). */
export function mimeFromFileName(fileName?: string | null): string | null {
  if (!fileName) return null;
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName).trim());
  if (!m) return null;
  return EXT_TO_MIME[m[1].toLowerCase()] ?? null;
}

/** Normalize a MIME string (lowercase, strip any `; charset=` parameters). */
export function normalizeMime(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  const base = String(mimeType).split(';')[0].trim().toLowerCase();
  return base || null;
}

export function isSupportedEvidenceFormat(mimeType?: string | null): boolean {
  const m = normalizeMime(mimeType);
  return m != null && SUPPORTED_EVIDENCE_MIME_TYPES.has(m);
}

export function isWithinSizeBudget(byteSize?: number | null): boolean {
  const n = Number(byteSize);
  return Number.isFinite(n) && n >= MIN_EVIDENCE_BYTES && n <= MAX_EVIDENCE_BYTES;
}

/**
 * Decide whether a captured file may be enqueued. Resolves the MIME from the descriptor, falling
 * back to the file extension. Fails CLOSED: an unknown/unsupported format or an out-of-budget size
 * is rejected (never queued), so certification can prove the gate refuses bad input.
 */
export function evaluateCapture(desc: CaptureDescriptor): CaptureDecision {
  const mime = normalizeMime(desc.mimeType) ?? mimeFromFileName(desc.fileName);
  if (!mime) return { accepted: false, reason: 'missing_mime' };
  if (!SUPPORTED_EVIDENCE_MIME_TYPES.has(mime)) return { accepted: false, reason: 'unsupported_format' };

  const n = Number(desc.byteSize);
  if (!Number.isFinite(n) || n < MIN_EVIDENCE_BYTES) return { accepted: false, reason: 'empty_capture' };
  if (n > MAX_EVIDENCE_BYTES) return { accepted: false, reason: 'too_large' };

  return { accepted: true, reason: null };
}

/**
 * Deterministic multi-page ordering. Stable sort by `pageOrder` ascending so a document captured
 * out of order (page 3 before page 1) is uploaded/assembled in the correct sequence; ties keep
 * their original capture order (stable).
 */
export function orderPages<T extends { pageOrder: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.pageOrder - b.item.pageOrder) || (a.index - b.index))
    .map(({ item }) => item);
}
