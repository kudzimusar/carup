# CarUp — Live OCR Operationalization: Receipt

- **Lane:** `fix/o2-live-ocr-operationalization`, branched from
  `feat/operations-o2-people-compliance@71b81d74`
- **Plan:** [CARUP_LIVE_OCR_OPERATIONALIZATION_PLAN.md](CARUP_LIVE_OCR_OPERATIONALIZATION_PLAN.md)
- **Scope:** document field extraction only. O2 stays frozen; PR #208 stays draft; Dealer
  activation, Service Network #197 and biometrics are untouched; nothing is deployed to production.
- This receipt records what changed and what was measured. It does not amend any earlier O2
  receipt.

## 1. What was actually wrong (read from the source, before any change)

| # | Defect | Where it was | Consequence |
|---|---|---|---|
| 1 | Extraction was **not image-based**. `extractDocumentData` called the TEXT client with `Image payload base64: ${base64Data.slice(0, 150)}` — 150 characters of base64 header | `documentIntelligenceService.js:95-99` | The model never saw the document. Any field it returned was invention conditioned on the declared document type |
| 2 | Blur, glare and tamper-suspicion scores were derived from an **MD5 hash** of the payload and returned as measurements | same file `:35-53` | Real `Poor_Image_Quality` and `Suspected_Tampering` verdicts were produced from a digest. Roughly 1 payload in 20 was flagged as tampered by arithmetic on a hash |
| 3 | Persistence filled unread fields with `'Unknown'`, `'N/A'`, **today's date as the date of birth**, `'M'` as sex, `2020` as the year — and reused the **national-ID number** as both the plate number and the customs bill-entry number | same file `:170-201` | The evidence tables recorded identity, vehicle and customs "candidates" no one had read |
| 4 | Confidence was `parsedData.confidenceScore \|\| 0.9`, and the identity gate fell back to the hash-derived **blur score** when none was reported | same file `:101`; `verificationSessionService.js:162,500` | An extraction with no provider confidence could clear the 0.75 verification threshold on a number nothing had measured |

## 2. What changed

**Real vision.** Extraction now goes through `askGeminiVision`, which sends the document bytes as
an `inline_data` part and throws on provider failure. The full payload is sent — the regression
suite decodes the image part from the captured provider call and asserts it equals the original
bytes exactly. Nothing of the payload enters the text prompt, the logs, or the evidence rows.

**Per-document schemas** (`documentSchemas.js`) for the Zimbabwe National ID, passport, driver's
licence, vehicle registration book and customs declaration, plus a business-document schema for
`dealer_*` compliance uploads. Each schema declares its own fields, its own normalizers and its
own core-field set; a registration book has no first-name field to fill and a national ID has no
VIN field to fill.

**Missing stays missing.** There are no runtime defaults left. A value survives only if it was
observed and normalizable:

- absence spellings from the provider (`N/A`, `not visible`, `unknown`, `—`) are read as absence;
- a date is accepted only when the calendar reading is unambiguous — `03/04/1990` is preserved as
  an unnormalized observation with the reason `ambiguous_day_month` rather than silently read as
  either 3 April or 4 March;
- a "VIN" that is not 17 characters, or contains I/O/Q, is not a VIN reading;
- an ICAO sex marker `X` is preserved as an observation with the reason
  `sex_marker_not_representable`, because the evidence column accepts only M or F — it is neither
  dropped silently nor forced into one of the two values the column will take.

**No placeholder rows.** The `ocr_national_ids`, `ocr_registration_books` and
`ocr_customs_declarations` tables are NOT NULL on their identity/vehicle columns, which is exactly
what forced the placeholders. A structured candidate row is now written only when every NOT NULL
column — including the confidence the column demands — was genuinely observed. **Absence of a row
is absence of a candidate.** No migration was required and no historical row was touched.

**Honest quality (disposition B of the plan).** `analyzeImageQuality` no longer estimates
anything. It reports `measured: false` with `not_measured` for blur, glare and tamper suspicion,
alongside the media facts that can genuinely be read from the file header — container format, byte
size, and pixel dimensions parsed from the PNG IHDR or the JPEG SOF marker. `Poor_Image_Quality`
and `Suspected_Tampering` are no longer emitted at all, because CarUp measures neither. The
diaspora OCR panel was updated to match: it now says "Not measured by CarUp" and shows the file
facts, instead of printing a hash-derived blur score to two decimal places.

**Provenance.** Every reading carries provider, model, execution status, requested and observed
document class, schema version, start time, extraction timestamp, latency, bytes sent, media type,
and whether confidence was reported. Confidence is `null` when the provider did not supply one —
never 0.9, never a blur score, and never a substituted 0 that would read as "zero confidence".

**Honest failure, distinct from an empty reading.** A provider that is unconfigured, unreachable,
or that returns malformed output records `executionStatus: provider_failed` and
`OCR_Provider_Unavailable`, with no fields. A provider that answered but read nothing records
`provider_succeeded` and `Pending_Manual_Review`. A file the provider cannot read (a text file, an
empty payload) is refused **before any bytes are sent** and records `not_attempted`.

**Test-mode simulation is labelled as simulation.** It remains gated on
`NODE_ENV=test && ALLOW_OCR_MOCK=true`, it is unreachable once a provider key is configured, and
everything it produces is stamped `provider: 'mock'`, `executionStatus: 'simulated'`. The failure
path no longer substitutes a sample document at all, so a real failure can never be dressed up as
a reading.

## 3. The accuracy corpus and gate

`backend/tests/tools/generate-ocr-corpus.mjs` renders eleven fixtures from the field values in
`ocr-corpus-manifest.json`, so the expected values **are** the pixels — the answer key cannot
drift from the image. Every document, person, number and vehicle is fictional and every fixture
carries a `SYNTHETIC TEST ASSET — NOT A REAL DOCUMENT` banner. No real identity document is used
anywhere in this lane.

| Fixture | Grading mode | What it probes |
|---|---|---|
| `national-id-clean` | strict | Full-field accuracy on a legible document |
| `national-id-rotated` (7°) | strict | Accuracy survives a realistic camera angle |
| `national-id-blurred` (6px) | no fabrication | A degraded document may yield nothing; it may not yield a guess |
| `national-id-glare` | no fabrication | Same, with a specular highlight over the right column |
| `national-id-cropped` (top 50%) | no fabrication + absence pins | `place_of_birth` and `date_of_issue` are **not in the image** and may not come back |
| `passport-clean` | strict | Passport schema |
| `drivers-licence-clean` | strict | Licence schema |
| `registration-book-clean` | strict | Vehicle schema, including a valid 17-character VIN |
| `customs-declaration-clean` | strict | Customs schema, including a decimal duty amount |
| `non-document` | no document | A landscape image must yield zero document fields |
| `unsupported-file.txt` | unsupported | Must be refused before any bytes reach the provider |

`ocr-accuracy-gate.mjs` runs the SHIPPED service over the corpus and grades field by field —
expected, extracted, match type (exact / normalized / missing / incorrect), provider, model,
latency, confidence. **A plausible but wrong value is a FAILURE; a missing value is graded as a
shortfall, not a fabrication.** The gate forces `ALLOW_OCR_MOCK=false` so a measurement can never
be taken against the simulation. Exit codes: `0` PASS, `1` FAIL, `3` NOT_RUN — NOT_RUN is
deliberately non-zero so an unrun gate can never be read as a passed one.

The grading arithmetic is itself unit-tested (`o2-ocr-accuracy-corpus.test.js`), including that a
one-digit difference in an ID number is graded `incorrect` and not a near miss.

## 4. Provider activation boundary

No credential was placed in the repository, in any log, or in any deployment. Nothing was
activated in production, and no O2 staging gate was mutated.

The gate's plumbing was smoke-tested end to end with a deliberately invalid key, which exercised
all eleven fixtures, the real provider call path and the grading: 0 fabrications, 37 shortfalls,
verdict FAIL — the correct result when the provider rejects the request. That proves the harness
runs; it measures nothing about extraction accuracy, and is not reported as an accuracy result.

**The accuracy gate has NOT been run against a live provider.** No OCR/vision provider is
configured for CarUp staging, and configuring one is a Product Owner credential decision.

## 5. Verification

All measurements below are from this lane's head, run on this machine.

| Gate | Result |
|---|---|
| **Full backend suite** (`node --test backend/tests/*.test.js` from repo root, CI env) | **5986 tests · 5965 pass · 0 fail · 21 skipped · exit 0** |
| **Full web suite** (`vitest run`) | **164 files · 1585 tests · 1585 pass · 0 fail · exit 0** |
| **TypeScript + production build** (`npm run build` = `tsc -b && vite build`) | **PASS** — 2776 modules transformed, built in 31.31s |
| **Lint regression gate** (`scripts/lint-baseline-gate.mjs` vs `71b81d74`) | **NET_NEW_ERRORS=0 · NET_NEW_WARNINGS=0 · exit 0** (advisory full-repo inventory unchanged at 135/9) |
| **OCR accuracy gate** | **NOT RUN** — no provider authorized (exit 3, by design) |

Named suites re-run individually:

| Suite | Result |
|---|---|
| `o2-x1-document-intelligence-authority` (the X1 boundary) | 6/6 |
| `o2-x2-registration-journey` · `o2-x2-registration-routes` | 13/13 · 9/9 |
| `o2-x3-identity-lifecycle` | 7/7 |
| `o2-x7-integrated-certification` (authority guards) | 13/13 |
| `verification-session-workflow` · `verification-ocr-provenance` · `verification-terminal-and-consistency` (7C identity) | 15/15 · 4/4 · 5/5 |
| `ocr-mock-guard` · `diaspora-ocr-route` | 3/3 · 13/13 |
| `non-seller-authority-hardening` · `issue164-phase3-trust-authority` | 8/8 · 57/57 |
| **`o2-live-ocr-operationalization`** (new) | **28/28** |
| **`o2-ocr-accuracy-corpus`** (new) | **13/13** |

### A measurement note worth recording

The first two full web runs reported failures — one test at 897 s, another at 138 s. Re-running
the first file in isolation gave **6/6 pass with 214 ms of test time and 596 s of module import**.
The machine was thrashing (swap 6.3 GB of 7.1 GB; ~16 MB free RAM), so the "failures" were the
default 5 s timeout firing on I/O starvation, not defects. The clean run above was taken with two
workers and a starvation-tolerant timeout; assertion failures are unaffected by that timeout, so
nothing is masked by it. Recorded because a contended run must never be read as a certification
result — in either direction.

## 6. The 41 new permanent guards

`o2-live-ocr-operationalization.test.js` (28) pins, against the SHIPPED service with a captured
provider: the document bytes are sent complete and unmodified as an image part; the truncated-text
path cannot return; unread fields are absent rather than defaulted; an incomplete reading writes no
structured row while a complete one does; an identity number is never reused as a plate number or a
bill of entry; quality is `not_measured` with only header-readable media facts; an unreported,
out-of-range or non-numeric confidence is discarded; the identity gate no longer substitutes a blur
score; a provider that is unconfigured, that errors, or that returns malformed output fails as a
provider failure with no fields; a provider that answered but read nothing is distinct from that;
an unsupported file is refused before any byte is uploaded; provenance is complete; each document
class uses its own schema; non-normalizable values are kept as observations rather than coerced;
absence spellings are read as absence; writes stay confined to the OCR evidence tables; a candidate
still needs the user and a governed reviewer; the test seam cannot become a production bypass; no
document bytes reach the logs or the evidence row; and test-mode simulation is labelled as
simulated and is unreachable once a key is configured.

`o2-ocr-accuracy-corpus.test.js` (13) pins the corpus and the grading: every fixture exists and is
a real PNG; every expected field is one the schema can produce; **every expected value is genuinely
printed on that fixture** (each is re-derived from the layout through the same normalizers); a
one-digit difference is `incorrect`, not a near miss; missing is a shortfall on a clean fixture and
acceptable on a degraded one, while guessing at a degraded field is still a fabrication; a cropped-
out field may not come back; any field read off a non-document fails; an unsupported file must be
refused before the provider; and the gate reports NOT_RUN with a non-zero exit when no provider is
authorized, so it can never be read as a pass.

## 7. Verdict

**LIVE OCR CODE READY — STAGING PROVIDER AUTHORIZATION REQUIRED.**

The extraction path is genuinely image-based and production-honest, the four fabrications are gone
and pinned against return, and the certified candidate → confirmation → governed-decision boundary
is intact. What remains is not code:

1. Product Owner authorization to configure an OCR/vision provider credential for CarUp **staging**
   (staging only; production stays untouched, and no credential enters the repository).
2. Run `node backend/tests/tools/ocr-accuracy-gate.mjs` with that credential and attach
   `OCR_ACCURACY_RESULTS.md`.
3. Re-run the §3A Live OCR Operational Check on the exact-head staging pair, where
   **manual-review fallback does not count as an OCR PASS**.

Until (1)–(3) are done, §3A of the Owner UAT pack stays **NOT READY**, and this lane is not
merged.
