# OC-5C — People & Identity completion (the #208 port)

Branch `feat/oc5c-people-identity-completion`, stacked on OC-5A and OC-5B and built from RC1
(`75449a16`). PR #208 (`e65c0bb8`) was **ported slice by slice, never merged**. Every slice was
re-read against this lineage. Where #208 was wrong here it was re-authored, and the defects it
would have introduced, or that RC1 already had, were closed with proofs.

Evidence levels follow `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`. Every slice below is
**SOURCE-certified** (CI plus mutation testing). Some are also **DATABASE-certified** (disposable
PostgreSQL, PGlite). Receipts are recorded in `certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

Nothing here is deployed, live-provider certified or owner-accepted. No migration was applied
anywhere.

## Slices

| Slice | Commits | CI | Mutants | Disposition |
|---|---|---|---|---|
| X3 lifecycle, step-up and step-up UI | `2e4e78d6` `f68c5eb5` `64aba1e6` `b88e951f` `ad52e7a8` | 37208871915 | 14/14 backend + 4/4 web | PORTED, re-authored |
| X6 `identity_assurance.v1` and semantic events | `a34c8c9c` | 37210340063 | 24/24 | PORTED, re-authored |
| RC1 applicant-session privacy | `fcb1a908` | 37210998758 | 5/5 | NEW FIX (found while porting X2) |
| X2 registration journey | `747fd19b` | 37212257514 | 16/16 backend + 6/6 web | PORTED, re-authored |
| X5 dealer onboarding | `3df411ca` | 37213448004 | 17/17 backend + 6/6 web | PORTED, re-authored, three gaps closed |
| X5 workbook migration lane | `c5a97909` | 37214395216 | 14/14 backend + 4/4 web | PORTED; AI through the governed adapter |
| U2 passport latency | `f5803a1e` | 37215112057 | 11/11 | RE-AUTHORED |
| X5A upload idempotency | `1d0d7003` | 37216436947 | 16/16 | BOUNDED PORT; candidate migration |
| X4 biometrics | `74cb8c5b` | see manifest | 7/7 | INTERFACE ONLY; provider NOT SELECTED |

## What changed beyond #208, and why

**X3.**
- A step-up requires a password re-proof on the presenting session, and passwordless step-up is refused.
- A step-up whose audit cannot be written is withdrawn.
- 503 is distinguished from 401, so the client does not sign the person out on an outage.
- An OCR-read document expiry is an observation and never moves the state.
- A restriction is lifted only by evidence filed after it.
- A compromise revokes sessions before it is recorded.
- The identity-history user FK is RESTRICT.
- Lifecycle and account-security powers are admin-only.
- A first approval reports "unchanged" rather than a refusal.

**X6.**
- The person's event carries a subject-safe status ("on hold", "under security review") and the applicant guidance. #208 sent the internal state (`compromised`) and the reason code to the person.
- The three templates are registered by migration. #208 emitted unregistered keys, which dead-letter.
- A dealer's "who must act" comes from the canonical projection. #208 told a rejected or suspended dealer that nobody had to act.

**Applicant-session privacy (RC1 defect).**
- The applicant's own session view returned `review_notes` (the reviewer's internal note) and `reviewer_identity`, and the mobile app displayed the note.
- Both are now reviewer-only.

**X2.**
- The journey reads identity standing through the subject view of `identity_assurance.v1`.
- Account type and business type are fixed once registered. On this lineage they open the logistics-provider marketplace and garage onboarding.
- Candidates come only from a reading a provider produced and that 7C did not distrust.
- A lost audit is reported, never returned as a 500.
- An unreadable standing fails closed.
- The profile write requires a real session.

**X5.**
- The dealer-role metadata route accepted a client `file_ref` and `status`. That let a document point at another person's private identity image, which the own-preview would have signed, and let a dealer self-mark a document "verified".
- Previews now sign only the dealer's own evidence prefix.
- `tenant_id` is no longer self-assignable. RC1 placed a dealer in any tenant's admin listing.
- Upload bytes must match the declared type.
- The reviewer raw-evidence preview needs a session, the Dealer Compliance capability and a fresh step-up, and is audited before the link is handed over.

**Workbook lane.**
- AI goes through `domainAdvisoryAdapter` (#208 called the retired `askGemini` directly), with headers only.
- An unexecuted answer proposes nothing, and every suggestion names its model.
- Confirmations use RESTRICT references and a checksum CHECK.

**U2.**
- One wave of independent reads; one ledger verdict per render, shared with the trust signals.
- T12.1 registry checks and the OC-3B verifyChain exit pin are kept.
- The latency gain itself is a DEPLOYED-level claim and is not made here.

**X5A.**
- An idempotency key is scoped to the actor. RC1 handed a second user the first user's evidence row.
- A key is bound to its vehicle and operation, and is looked up with parameterized reads (#208 used an `.or()` built from the client key).
- Content outranks location only when CarUp computed the checksum in the same request.
- #208's HMAC provenance stamp is not ported.

**X4.**
- Provider contract, normalization, the null provider and a block-only approval gate.
- Nothing calls a provider.

## Deferred, and why

- **Company-document OCR for dealers.** #208 bypassed governed Document Intelligence. It needs the governed OCR pattern (owner / OCR programme).
- **X4 consent and assessment services, routes and UI.** They would collect consent for, and record, checks that cannot run until a provider is selected.
- **#208's own X5A workbook catalogue (`06ef4b9a`)** and `workbook.import.completed`. Not part of this port.
- **#208's per-stage passport timing log.** It would add a free name to a function that four harnesses execute from source.

## Candidate migrations (not promoted)

- `database/migration-candidates/oc5c/20261004174000_o2_vehicle_evidence_upload_idempotency.sql`: the actor-scoped unique index. Not applied anywhere (verified absent on canonical staging by OC-5R). Until it is promoted and applied, concurrent dedupe is not in force on any deployment.
- `…/20261004175000_o2_x4_identity_biometric_consents.sql` and `…/20261004175100_o2_x4_verification_assessments_biometrics.sql`: these move only with a selected provider. Correction (OC-5R): they are **present on canonical staging**, applied by PR #208's runs with no ledger row, and held under custody exception X4-BIOMETRIC-CONSENT-LEDGER in `database/convergence/oc5r-lineage-exceptions.json`.

## Open owner decisions recorded by this phase

1. Promote the X5A idempotency candidate (staging first).
2. Port #208's HMAC provenance stamp. Recommendation: **no**.
3. X4 provider selection, the provisional thresholds, and the consent ledger's user FK (CASCADE in the candidate, RESTRICT for identity history).
4. Company-document OCR for dealer onboarding.
5. Earlier OC-5C decisions:
   - government keeps the full People capability set, apart from lifecycle and account security;
   - an OCR-read expiry is an observation only;
   - identity history is RESTRICT.
