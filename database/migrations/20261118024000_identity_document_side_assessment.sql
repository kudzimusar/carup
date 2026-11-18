-- Status and schema-field attribution only. Raw images remain in private evidence storage.
ALTER TABLE public.verification_sessions
  ADD COLUMN IF NOT EXISTS ocr_side_assessment jsonb;

COMMENT ON COLUMN public.verification_sessions.ocr_side_assessment IS
  'Current OCR side verdict and source field names. Exposed only in protected case detail.';
