# Trade OS T8 — Documents & Evidence workspace · Implementation plan

**Status:** IN IMPLEMENTATION. Authorized 2026-09-07 at head `0e929d63`, immediately after the T7
freeze (`T7-USABLE`, runtime `3f062fc0`). T9+ NOT authorized.

**Objective:** one coherent Documents & Evidence workspace over the authorities that already exist —
without letting a file's existence become a business fact.

---

## 1. T8.0 — Document / evidence authority audit (COMPLETE)

T8 is emphatically **not greenfield**. Every layer already has an owner.

### 1.1 The authority map

| fact | canonical authority | binding today |
|---|---|---|
| **document record** | `diaspora_trade_documents` (+ `diasporaDocumentService`) | **`import_order_id` ONLY** |
| **bytes / storage** | `diaspora_drive_files` (+ `diaspora_drive_connections`, `_sync_attempts`) | generic `linked_entity_type` + `linked_entity_id`, `checksum_sha256`, `permission_scope`, `sync_status`, `revoked_at` |
| **classification / extraction** | `diaspora_trade_document_extractions`, `ocr_documents` + `ocr_*`, Document Intelligence | per document |
| **verification** | `diaspora_trade_document_verifications` (+ `verifyTradeDocument` / `rejectTradeDocument`) | per document, with `verified_by` / `verified_at` |
| **checklist expectation** | `trade_document_types` (carries `verification_required`), `trade_document_rules`, `trade_document_templates` | vocabulary |
| **participant-stated readiness** | `diaspora_trade_document_readiness` (+ `tradeDocumentReadinessService`) | generic `subject_type` + `subject_id` |
| **vehicle evidence** | `vehicle_evidence`, `vehicle_documents`, `vehicle_government_documents`, `evidence_sets`/`_sources`/`_provenance_events` | vehicle domain |

**No competing document authority will be created.** Storage stays a provider; Drive is not the
business record.

### 1.2 The gap that matters

The **record** is the only layer that has not generalised. `diaspora_trade_documents` binds to
`import_order_id` and nothing else — so a **logistics request**, a **container reservation/sailing**
or a **Trade Order** cannot own a document at all, while `diaspora_trade_document_readiness` and
`diaspora_drive_files` already carry a generic subject binding for the very same domain.

Secondary: readiness accepts only `{import_order, logistics_request}` — container bookings are
excluded.

### 1.3 Gaps → slices

| # | gap | slice |
|---|---|---|
| **G1** | the document record binds only to a procurement order | T8.1 |
| **G2** | readiness subjects exclude container bookings | T8.1 |
| **G3** | no single Documents & Evidence workspace; uploads are scattered | T8.3 |
| **G4** | replacement/versioning semantics unproven | T8.4 |
| **G5** | presence-vs-verification is modelled but uncertified end to end | T8.2 |

---

## 2. The permanent truth model

These are **seven different truths** and T8 may never collapse them:

```
FILE EXISTS  →  DOCUMENT PRESENT  →  DOCUMENT CLASSIFIED  →  FIELDS EXTRACTED
             →  DOCUMENT REVIEWED →  DOCUMENT VERIFIED    →  FACT VERIFIED
```

- a Drive file existing is **not** "document verified";
- OCR text is **not** "fact true";
- a document labelled *invoice* is **not** "payment occurred";
- a bill of lading is **not** "shipment departed";
- a customs document is **not** "customs cleared";
- a warehouse photo is **not** "cargo received".

Where no authorized verifier has reviewed a document, the UI says **Present / Awaiting review** —
never *Verified*.

## 3. Slices

- **T8.0** authority audit — **COMPLETE** (§1).
- **T8.1** generalise the document binding to the subject vocabulary the domain already uses, and
  extend readiness to container bookings. Additive and nullable; no rewrite of existing rows.
- **T8.2** presence-vs-verification certification: a client cannot assert `verified`, an uploader
  cannot verify their own document, and OCR alone never verifies.
- **T8.3** the workspace: one checklist-driven surface per transaction.
- **T8.4** replacement/versioning: history is never destroyed.
- **T8.5** privacy: co-loader isolation, cross-tenant refusal, no raw credentials or internal paths.
- **T8.6** responsive across the seven certified widths.
- **T8.7** staging certification + owner-UAT proxy.

## 4. Phase firewall

T8 may store and present evidence relating to later phases. It may **not** manufacture their state.
T9 warehouse · T10 loading · T11 shipment · T12 customs · T13 settlement · T14 reputation ·
T15 Intelligence remain their own authorities.

**T12-BLOCKER carried forward unchanged:** `documentIntelligenceService` writes a fabricated customs
exchange rate and duty. T8 must never present that row as verified customs evidence.
