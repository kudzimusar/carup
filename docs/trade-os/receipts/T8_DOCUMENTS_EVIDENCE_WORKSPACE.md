# Trade OS T8 — Documents & Evidence workspace · Receipt

**Status: `T8-PARTIAL` — OWNER ACCEPTANCE REMAINS.** Candidate `e4283fe1`. T9 not started.
Production untouched. PR #207 Draft.

## 1. T8.0 — the authority audit, and what it found

T8 is **not greenfield**. Every layer already had an owner:

| fact | canonical authority | binding |
|---|---|---|
| document record | `diaspora_trade_documents` (`diasporaDocumentService`) | **`import_order_id` only** |
| bytes / storage | `diaspora_drive_files` (+ connections, sync attempts) | generic `linked_entity_type`/`linked_entity_id`, `checksum_sha256`, `permission_scope`, `revoked_at` |
| classification / extraction | `diaspora_trade_document_extractions`, `ocr_*`, Document Intelligence | per document |
| verification | `diaspora_trade_document_verifications` | its own row, with `verified_by`/`verified_at` |
| checklist expectation | `trade_document_types` (carries `verification_required`), `trade_document_rules`, `_templates` | vocabulary |
| participant-stated readiness | `diaspora_trade_document_readiness` | generic `subject_type`/`subject_id` |
| vehicle evidence | `vehicle_evidence`, `evidence_sets`/`_sources`/`_provenance_events` | vehicle domain |

**No competing document authority was created.** Google Drive remains a storage provider, not the
business record.

## 2. The two things that were actually wrong

### 2.1 Presence collapsed into verification — the defect this phase exists to prevent

`createTradeDocument` read:

```js
verification_status: payload.verification_status || DOCUMENT_STATUSES.UPLOADED,
```

**A client could post `verification_status: 'VERIFIED'` at upload time.** The verify and reject
endpoints are properly `reviewerAuth`-guarded — this path simply never went through them, so the
guard was real and irrelevant at the same time.

An uploaded document is now **UPLOADED, always**, and only the governed reviewer endpoints may move
it. A customer cannot assert their own document verified. Presence is not verification.

### 2.2 The record was the only layer that never generalised

`diaspora_drive_files` already carried a generic linked-entity binding and
`diaspora_trade_document_readiness` already carried `subject_type`/`subject_id` — **for the same
domain** — while the document record bound to `import_order_id` and nothing else. So a **logistics
request**, a **container sailing** or a **Trade Order** could not own a document at all.

Migration `20260909090000` is **additive and reversible**: nullable columns, no row rewritten,
existing procurement rows keep `import_order_id`. Three CHECKs enforce it in the database:

- a subject is a **pair or nothing** — a type without an id points at every object of that kind;
- **exactly one owner** — a document belonging to two things belongs to neither;
- a **bounded vocabulary** — free text is how a shadow entity gets invented later without anybody
  deciding to.

Readiness now accepts the same four subjects; it and the document binding had drifted apart.

## 3. The truth model, asserted rather than assumed

```
FILE EXISTS → DOCUMENT PRESENT → CLASSIFIED → EXTRACTED → REVIEWED → VERIFIED → FACT VERIFIED
```

Tests pin: an uploaded document starts UPLOADED; every verify/reject route carries `reviewerAuth`;
**recording an OCR extraction never sets VERIFIED** (OCR is an observation, not a verdict);
verification is its own row with who and when, and is audited; and T8 never writes a later-phase
fact (`customs_cleared`, `shipment_departed`, `cargo_received`, `payment_reconciled`,
`warehouse_receipt`, `measured`, `loaded`).

## 4. Evidence at `e4283fe1`

| gate | result |
|---|---|
| full backend suite (ci.yml env) | **6070 passed / 0 failed** (21 skipped) |
| T8 documents suite (new) | **9/9** |
| T8 PGlite migration gate (new, own CI step, **confirmed executed**) | **12/12** |
| T6 PGlite gate · migration integrity | ok · ok |
| lint regression | NET_NEW_ERRORS=0 |
| CI | **7 workflows green**, 1 skipped by design |

**Six mutations proven:** the presence→verified collapse, the exactly-one-owner rule, the subject
vocabulary, a verify route losing its reviewer guard, readiness dropping container bookings, and the
database CHECK itself.

Migration applied to **staging only** (1 existing row, still procurement-bound, untouched).

## 5. Two gates that caught me

- The PGlite gate **reported every check green and exited 100**, because the database was never
  closed. A gate that says PASS and fails the build is worse than either outcome alone, and it was
  visible only by checking the exit code rather than reading the output.
- A single **trailing space** failed `Vehicle Passport Foundation CI` via `git diff --check`. The
  workflow was green on the commit before mine, so the baseline made attribution unambiguous rather
  than a guess.

## 6. Not done — what `T8-PARTIAL` is missing

- **T8.3** the workspace UI: no single checklist-driven Documents & Evidence surface yet; uploads
  remain where they were.
- **T8.4** replacement/versioning semantics are unproven — no test yet asserts that replacing a
  document preserves the prior version and its attribution.
- **T8.5** the privacy/adversarial walk (co-loader isolation, cross-tenant refusal, forged storage
  reference, no raw credentials) is not executed.
- **T8.6** responsive certification not run for document surfaces.
- **T8.7** staging journeys A–F not walked.

**T12-BLOCKER carried forward unchanged.** `documentIntelligenceService` still writes a fabricated
customs exchange rate (13.5) and duty (50000). T8 does not read it and must never present it as
verified customs evidence.

**This agent does not mark `T8-USABLE`.**

---

# T8 closure and owner acceptance — 2026-09-07

**Status: `T8-USABLE` — OWNER ACCEPTED. Runtime frozen at `00f164e4`.**

## Chronology — preserved

| stage | SHA | verdict |
|---|---|---|
| T8.0–T8.2 first pass | `e4283fe1` | `T8-PARTIAL` — the receipt named what was missing |
| product closure: workspace + versioning | **`00f164e4`** | **`T8-USABLE`** |

### Why the runtime moved from `e4283fe1`

Because the two things the PARTIAL receipt named as missing were real product gaps, not paperwork:
**there was no workspace** (documents lived on a procurement-only page, so a logistics request or
container booking could own a document that no screen could show) and **there was no versioning at
all**.

## §F · T8.4 versioning — replacement destroys nothing

There was none. A corrected invoice could only be added as an unrelated second row, or the first
overwritten — neither answers the question an audit actually asks, *"what did we hold at the
time?"*, and the second destroys evidence.

A replacement is now a **new row pointing back at its predecessor**. The superseded row keeps its
verdict, its reviewer, its timestamps and its attribution, and is simply no longer current.

- **V2 starts UPLOADED even when V1 was VERIFIED.** Inheriting a verdict on a file nobody has looked
  at is the presence→verified collapse wearing a different hat.
- The owner is **inherited, never re-supplied** — a replacement cannot smuggle evidence between
  transactions.
- The predecessor is marked superseded **only after** the new version exists; marking first would
  leave a transaction with no current document if the insert failed.
- The database refuses a **second concurrent replacement** of the same version, self-supersession,
  version zero, and "replaced by somebody at no particular time".
- `GET /trade-documents/:id/lineage` walks the chain, so history is auditable rather than implied.

Migration `20260910090000`, additive and reversible, gated by `trade_os_t8_versioning_check.mjs`
(**11/11**) as its own CI step.

## §C · T8.3 the workspace

One surface for one transaction, whichever of the four governed subjects it is. Access is derived
**entirely from the transaction**: a competing supplier who never offered is refused, and a
co-loader is a participant only through their own booking.

It refuses to collapse seven truths into one tick:

| what happened | what the row says |
|---|---|
| nothing supplied | **Not supplied** — never "required"; nothing here establishes a legal requirement |
| supplied, type needs a verdict | **Supplied — awaiting review** ("Nobody has checked it yet") |
| supplied, type needs no verdict | **Supplied** ("This kind of document is not checked by CarUp") |
| a reviewer verified it | **Verified** |
| a reviewer rejected it | **Rejected** ("A corrected version can be supplied") |
| the participant said it does not apply | **Does not apply** |

Extraction having run is reported as **provenance** ("text was read automatically") and never as a
status. The page states the contract in words — *"A document being present does not mean it has been
checked, and a document being checked does not make what it describes true"* — rather than leaving
it to colour, and adds that CarUp decides no duty, tax or customs outcome from these documents.

The checklist is driven by the **governed `trade_document_types` vocabulary** (16 types on staging),
not a second list hardcoded in React.

## §N/§I/§L · staging certification at `00f164e4` — 0 findings

Paired FE/BE, every `/api/` call to the branch backend only.

| check | result |
|---|---|
| requester opens their shipping-request workspace | 200, 16 governed items |
| nothing claimed verified without a verdict | ✅ |
| anonymous · rival who never offered · forged subject **kind** · forged subject **id** | all refused |
| **POSITIVE CONTROL:** genuine sailing participant allowed | ✅ (`participant`) |
| **POSITIVE CONTROL:** sailing operator allowed | ✅ (`operator`) |
| non-participant refused the sailing workspace | ✅ |
| phase firewall — `customs_cleared`, `cargo_received`, `shipment_departed`, `payment_reconciled`, `warehouse_receipt` | never asserted |
| no internal table/column names on screen | ✅ |
| seven widths (393→1536) | no overflow |

## §P · Gates at `00f164e4`

| gate | result |
|---|---|
| full backend suite (ci.yml env) | **6091 passed / 0 failed** (21 skipped) |
| T8 documents + workspace suites | 16 + 14 |
| T8 PGlite gates (binding · versioning), own CI steps | **12/12 · 11/11** |
| web diaspora | **204/204** |
| `tsc -b` · lint regression | PASS · NET_NEW_ERRORS=0 |
| CI | **7 workflows green**, 1 skipped by design |

**Ten mutations proven** across three layers: a supplied document rendering as Verified · OCR
advancing the state · superseded versions shown as current · co-loader isolation removed · supplier
relationship proof removed · replacement inheriting VERIFIED · replacement deleting its predecessor ·
replacement re-supplying the owner · marking superseded before the insert · the database concurrency
index downgraded (caught by the PGlite gate, which is the right gate for a database guarantee).

## `T8-USABLE` does not mean production-ready

Production readiness remains **T18**. Production is NOT AUTHORIZED and untouched; migrations are
staging-only.

## Carried forward

- **T12-BLOCKER unchanged.** `documentIntelligenceService` still writes a fabricated customs
  exchange rate (13.5) and duty (50000). T8 does not read it, and the workspace never says
  "customs verified" — the firewall test names `customs_cleared` explicitly.
- **Upload byte-path failure/recovery (§E2)** is not certified: the governed upload lifecycle and
  its two-phase reconciliation were not exercised end to end against a real storage failure. Recorded
  as open rather than claimed.
- Live OCR remains unavailable on staging (the O2 provider billing block); the extraction boundary is
  certified by contract, not by a live provider run.
