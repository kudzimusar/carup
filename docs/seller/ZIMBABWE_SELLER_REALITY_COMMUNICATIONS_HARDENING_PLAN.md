# Zimbabwe Seller Reality & Communications Hardening — Execution Plan

**Status:** ACTIVE  
**Parent tracker:** `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md §0.8`  
**Integration target:** `integration/vehicle-passport-v16-cert` / Draft PR #194  
**Continuation branch:** `fix/zimbabwe-seller-reality-comms-hardening`  
**Frozen start:** `f180c47da644d75bea6a7ad67041c21a2a6bcdf4`

This plan records the implementation detail for the 2026-09-02 owner-approved remediation. It does not replace the master tracker. A task is complete only when the matching ZR item in the master tracker is checked with evidence.

## 1. Product law

1. A Zimbabwe permanent import may be a legitimate Marketplace listing before local registration is complete.
2. Registration progress is a **readiness state**, not a synonym for Trust, fraud or vehicle quality.
3. TIP describes a temporary foreign-vehicle admission and is not the generic fallback identifier for a permanently imported vehicle awaiting CVR registration.
4. Japanese chassis/frame identifiers remain legitimate identifiers; CarUp never fabricates a 17-character VIN.
5. Missing evidence remains unknown/pending. It never becomes “clear”, “registered”, “not damaged”, “not financed” or another flattering claim.
6. Google Drive is an archival/operations mirror. Canonical Evidence Vault records, visibility, checksums/provenance and public projection remain CarUp authorities.
7. External mailbox verification proves mailbox control. An authenticated in-app session is not a substitute.
8. Notifications are action/status items; Conversations are two-way threads. Security actions are never dumped into a generic chat thread.

## 2. Registration lifecycle

Canonical vocabulary:

| Code | Public label | Meaning | Ordinary listing visibility |
|---|---|---|---|
| `import_in_transit` | Import in transit | Export/shipping/transit evidence; vehicle has not completed Zimbabwe import process | allowed only when other publication requirements pass; strong pending disclosure |
| `arrived_customs_pending` | Arrived — customs pending | Arrived/entered region but Zimbabwe customs clearance not established | conditional listing; not road-ready |
| `customs_cleared_cvr_pending` | Customs cleared — local registration pending | Zimbabwe customs clearance established; CVR first registration incomplete | listable; amber pending disclosure |
| `cvr_plate_pending` | CVR processing — plate pending | CVR process evidenced, local plate/book not yet issued | listable; high readiness but not “registered” |
| `locally_registered` | Locally registered | Current Zimbabwe registration established | normal |
| `temporary_foreign_tip` | Temporary foreign vehicle — TIP | Foreign-registered temporary admission | not treated as ordinary permanent-import sale readiness; policy warning/block where sale is not permitted |
| `reregistration_pending` | Re-registration pending | Previously registered/de-registered vehicle awaiting governed re-registration | conditional, disclosed |
| `unknown` | Registration status not established | Seller/CarUp has not established stage | draft/restricted until policy permits |

Implementation rule: the code owns one vocabulary and a presentation helper. Seller input may state a stage, but governed evidence/source integrations determine whether it can be called verified.

## 3. Trust/readiness separation

- Refactor canonical Trust identity dimension so it evaluates the durable vehicle identity independently of a Zimbabwe plate/TIP.
- Add/derive a registration-readiness presentation dimension from explicit stage + governed evidence/completeness.
- Do not add an arbitrary negative score for `*_pending`.
- Preserve canonical Trust cache/version rules and public projection invariants.

## 4. Evidence taxonomy

Add a ninth first-class evidence class `registration` because first registration/re-registration is neither “accident” nor necessarily “ownership transfer”.

New import subtypes:
- `commercial_invoice`
- `payment_receipt`
- `transit_declaration`

New registration subtypes:
- `cvr_first_registration`
- `registration_book`
- `registration_plate_record`
- `police_clearance_first_registration`
- `reregistration_record`
- `temporary_import_permit`

Legacy mapping for **new uploads**:
- `registration_document -> registration`
- `police_clearance_document -> registration`
- `ownership_transfer_document -> ownership_transfer`

No blind rewrite of historical rows whose earlier classification may encode different context.

## 5. Seller Drive workspace

Reuse `backend/services/diaspora/drive/googleDriveProvider.js` and the existing credential vault. Add a thin Seller workspace service that:
- accepts an already-authorized Drive credential reference;
- find-or-creates `CarUp Sellers/<stable user key>/<canonical vehicle key>/...`;
- creates the standard folders idempotently;
- stores only Drive IDs/opaque references needed for operational mapping;
- never returns provider tokens;
- never promotes Drive URLs into public evidence;
- marks originals and derived/redacted artifacts through appProperties/description and checksums.

Standard vehicle folders:
- `00 ORIGINAL MASTER - DO NOT EDIT`
- `01 Identity - Restricted`
- `02 Purchase & Payment - Private`
- `03 Export & Shipping`
- `04 Customs & Transit`
- `05 Inspection & Compliance`
- `06 Zimbabwe Registration & Licensing`
- `07 CarUp Evidence Upload Set`
- `08 Listing Media - Originals`
- `09 Transaction & Handover`

## 6. Email verification

Keep current custom CarUp auth authority:
- user is created with a password;
- verification email proves mailbox ownership only;
- reset-password remains a separate flow.

Hardening:
- registration surfaces provider acceptance vs queued vs failure based on the canonical delivery attempt, not merely queue insertion;
- external verification email content/CTA uses the branded auth renderer;
- resend endpoint remains non-enumerating;
- verification token never appears in an in-app notification payload/body;
- successful verification emits the existing durable `user.email.verified` event.

## 7. Notifications and Communications

Notification bell:
- query/present only in-app eligible notifications (or a safe projection of cross-channel delivery status);
- every row owns an action model: deep-link, mark-read, or informational no-op explicitly disabled;
- never render security token URLs;
- no inert clickable-looking rows.

Communications:
- conversation list is for threads with real participants/workflows;
- Support and Marketplace remain reply-capable where authorization allows;
- security/account notifications are not promoted into General conversations merely because a notification row has a message/thread record;
- provider channel controls reflect runtime health truthfully.

## 8. Serena UAT mapping

For the Serena document pack, current evidence supports:
- Japanese identity/export provenance;
- bill of lading/shipping provenance;
- Tanzania through-transit provenance;
- Zimbabwe CBCA/Cotecna historical inspection evidence;
- purchase/payment evidence;
- seller KYC.

It does **not** by itself establish Zimbabwe customs clearance, CVR registration or a current Zimbabwe plate. Until those are supplied, the truthful state is **local registration pending / exact sub-stage not fully evidenced**, never “locally registered”.

## 9. Gates

- targeted backend tests for registration vocabulary/publication/Trust/evidence taxonomy/Drive/email/notifications;
- targeted web tests for Seller registration UI, notification bell, Communications and public presentation;
- TypeScript + lint-regression;
- migration syntax/real-Postgres harness where schema changes;
- staging exact-head provider verification using an authorized test inbox;
- existing Seller golden lifecycle + Marketplace + Passport + Communications affected gates;
- desktop/tablet/mobile Chromium and accessibility;
- exact frontend/backend SHA pairing before owner UAT.

## 10. Roll-call

- [~] Plan/tracker amendment committed before product changes.
- [ ] Registration lifecycle model.
- [ ] Trust/readiness separation.
- [ ] Evidence taxonomy expansion.
- [ ] Seller Drive workspace service + current Serena folder organization.
- [ ] Verification email delivery hardening.
- [ ] Notification bell action/channel hardening.
- [ ] Communications semantic separation.
- [ ] Seller route failure/recovery regression remains green.
- [ ] Targeted tests green.
- [ ] Full affected certification green.
- [ ] Exact-head staging UAT ready.
