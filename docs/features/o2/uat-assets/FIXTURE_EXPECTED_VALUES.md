# Synthetic identity fixture — expected values (staging UAT only)

These are the values **rendered into the actual pixels** of the synthetic assets in this
directory. They exist so a live extraction can be compared against known truth. Every value is
fictional; there is no real person, no real document and no real PII.

| Field | Value rendered in `synthetic-id-front.png` |
|---|---|
| Document banner | `SYNTHETIC TEST ASSET` / `NOT A REAL IDENTITY DOCUMENT` |
| Last name (surname) | `SPECIMEN` |
| First / given names | `UAT SYNTHETIC` |
| Document number | `SPECIMEN-0000-UAT` |
| Date of birth | `01 JAN 1990` (fictional) |
| Expiry | `01 JAN 2035` (fictional) |
| Footer | `Generated for CarUp O2 owner UAT — uploading this proves the WORKFLOW, never an identity` |

`synthetic-id-back.png` renders `REVERSE SIDE — SPECIMEN` and `Machine-readable zone: FICTIONAL`.
`synthetic-selfie.png` renders `NOT A REAL PERSON — PLACEHOLDER SELFIE`.

Image facts: 1012 × 638 px PNG, high-contrast dark text on a light ground, 24–54 px type — i.e.
comfortably legible to any working OCR/vision model. A failure to read these is a failure of the
extraction pipeline, not of image quality.
