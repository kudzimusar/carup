# O2-X4 — Biometrics + Explicit Consent: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance`
- **Starting head:** `3648758e` (X3 docs) · **Date:** 2026-09-03
- **Scope executed:** X4 ONLY. X5–X7 not started; **P7 remains BLOCKED / NOT EXECUTED**;
  P1/P1-C, X1, X2 and X3 untouched and re-proven green.

## THE TWO GATES — never merged

```
BIOMETRIC ARCHITECTURE CERTIFIED        ← this receipt closes THIS gate
LIVE BIOMETRIC PROVIDER: NOT ACTIVATED  ← open; requires PO provider selection + the
                                          compliance register below + sandbox certification
```

No real provider execution occurred anywhere in this phase — every runtime call resolves the
honest null provider (`provider_state = not_configured`); no claim of real biometric
verification is made, and the software being complete is NOT legal approval to process
biometrics in production.

## 1. Consent model

`identity_biometric_consents` — append-only, DB-enforced, seq-ordered ledger. Each event:
subject (always the authenticated caller — never a payload field), session reference, status
`granted|withdrawn`, purposes (`face_document_match`,`liveness`), `biometric_consent.v1`, the
exact consent-text version shown (`biometric_consent_text.v1`), source, actor, supersedes
link, timestamp. Grant is AFFIRMATIVE: an explicitly ticked box (never pre-checked) + a
matching text version; Terms/Privacy acceptance, selfie upload, account creation and Submit
are refused as consent by construction and by test. The applicant disclosure covers: face ↔
document comparison, liveness (not a photo/video/replay), processing by an approved provider,
sensitive-data processing and purpose, retention handling, and withdrawal/fallback
consequences. Withdrawal: a new ledger row — stops NEW processing (provider-spy-proven),
erases nothing, keeps the manual-review path open; where continued biometric assurance is
policy-required, the X3 lifecycle's `reverification_required` is the lever (historical 7C
rows are never rewritten). Provider-held-data deletion is an ACTIVATION-scope obligation:
`deletion_requested` vs `deletion_completed` tracking binds to the selected vendor's actual
deletion API and is deliberately not pretended before one exists.

## 2. Provider architecture

Provider-neutral contract (`biometricProvider.js`): adapters return RAW payloads; CarUp
normalizes exactly once into its own vocabulary — `face_match_status`
(`match|mismatch|indeterminate|provider_failed|not_run`), `liveness_status`
(`passed|failed|indeterminate|provider_failed|not_run`), provider states incl.
`not_configured`. Threshold policy is server-owned and versioned (`biometric_threshold.v1`:
match ≥ 0.85, mismatch ≤ 0.40, liveness ≥ 0.80; between thresholds ⇒ indeterminate, never
rounded up) and recorded on every row. The registry resolves ONLY the null provider today;
an unknown configured vendor throws by name; injected doubles are refused outside
`NODE_ENV=test`. **Selected provider: NOT SELECTED** — evidence matrix and selection
preconditions in `CARUP_OPERATIONS_O2_X4_BIOMETRIC_PROVIDER_DECISION.md` (Veriff and Sumsub
are the researched candidates; commitment requires PO approval, a DPA, and Zimbabwe-document
sandbox trials).

## 3. Face-match and liveness models

Two SEPARATE provider-provenanced evidence dimensions on the existing append-only
`verification_assessments` (additive columns only): status + score each, plus
`provider`/`provider_model`/`provider_reference`/`provider_state`,
`threshold_policy_version`, `consent_id`, flags and hashes. A score above threshold is
"high-confidence biometric evidence", never "verified". Liveness originates ONLY from a
provider — selfie existence, camera permission, freshness, timers and UI completion prove
nothing (pinned). Client-submitted scores/verdicts are inert: the route accepts the session
id alone. `identityBinding.js` is byte-for-byte the same name-vs-name dimension —
`identity_binding_status` was not renamed and gates independently (a provider MATCH does not
lift a name mismatch, test-pinned).

## 4. Decision integration

`decisionPolicy` consumes the biometric dimension: `mismatch` or `failed` liveness BLOCK
approve (recommend escalate / resubmission — provider failure is never auto-rejection);
`indeterminate`/`provider_failed`/`not_run` keep every human action open (safe fallback →
manual review). The recorder evaluates the same policy server-side, so the gate holds even
against a client that renders its own buttons. Reviewer UI shows a Biometric Evidence section
(consent state, provenance, statuses + scores, flags, degraded notes) with ZERO buttons of
its own — no "approve because biometric passed" exists anywhere. New reason codes:
`BIOMETRIC_CONSENT_REQUIRED`, `FACE_MATCH_FAILED`, `FACE_MATCH_INDETERMINATE`,
`LIVENESS_FAILED`, `LIVENESS_INDETERMINATE`, `BIOMETRIC_PROVIDER_UNAVAILABLE`,
`BIOMETRIC_CAPTURE_RETRY_REQUIRED` — applicant guidance actionable, anti-fraud internals
withheld.

## 5. Retention / data-minimisation design

**CarUp stores the assessment, provenance, consent and governed decision — not biometrics.**
No face embeddings, templates, vectors or biometric media are persisted; no fingerprint
fields, endpoints or capture UI exist (enrollment remains out of scope; passkey/device
biometrics stay X3 AUTHENTICATION). Pinned repo-wide: expansion-era migrations may not even
contain the word "fingerprint"; identity-domain code may not touch it; no
template/embedding construct may appear anywhere. Evidence media stays in the governed 7C
private storage with its existing step-up-protected preview path (X3 pin re-proven in-suite).
Data retained by the provider: none today (no provider is called); upon activation, governed
by the DPA per the provider decision doc.

## 6. Zimbabwe compliance activation register (obligations to satisfy BEFORE live processing)

Evaluated and recorded — NOT legal approval; production activation requires each item
satisfied and signed off:

| Obligation | Status |
|---|---|
| Sensitive-data (biometric) consent under the Data Protection Act [Chapter 11:12] (Act 5 of 2021) | Architecture delivers explicit, purpose-scoped, versioned, withdrawable consent — legal review of wording required before activation |
| Data-controller licensing/registration with POTRAZ (the DPA authority) as applicable to CarUp's processing | OPEN — to confirm with counsel before activation |
| Data processor agreement with the biometric provider | OPEN — precondition of provider selection |
| Retention/deletion | CarUp-side minimisation implemented; provider retention + deletion flow bound at selection |
| Access controls | Reviewer evidence behind proven session + step-up (X3); applicant self-scope proven; RLS on all new tables |
| Breach handling | Follows CarUp's existing security-incident path; provider breach-notification terms to be contracted in the DPA |
| Cross-border processing/transfer (provider processing outside Zimbabwe) | OPEN — DPA transfer conditions to be satisfied per the selected provider's processing geography |

## 7. Lifecycle integration

Biometric outcomes never rewrite history and never auto-mark `compromised` — compromise stays
the X3 governed security policy. Fresh-assurance policy uses `reverification_required`.
Historical `resolved_approved` sessions proven untouched by assessments (session row
byte-compared in-suite).

## 8. Code changed

**New:** 2 migrations (`20260903210000` consents ledger · `20260903211000` assessment
biometric columns) · `services/identity/biometrics/` (provider contract, consent service,
assessment service) · `routes/identityBiometricRoutes.js` · 2 backend suites.
**Edited:** `decisionPolicy` (+biometric dimension) · `decisionRecorder` (evidence-aware
gate) · `verificationSessionService` (reviewer payload: `biometric` + `biometric_consent`) ·
`reasonCodes`/`caseWorkflow` (+7 codes, biometric category) · `registrationJourneyService`
(applicant biometric leg) · shared `verificationStatus.ts` (+2 typed summaries) · applicant
journey page (+consent block, check leg, fallback messaging) · reviewer page (+evidence
section) · `useCarUpApi` (+3 typed fns) · server mounts.

## 9. Gates (final tree; sequential, uncontended; CI env)

| Gate | Result |
|---|---|
| New X4 suites (consent PGlite 6 · assessment/policy/runtime 10) | **16/16** (both migrations executed against real PostgreSQL in-suite) |
| 7C identity + X2 + X3 neighbors (post-integration smoke) | **67/67** |
| Affected web pages (journey + reviewer, incl. 4 new X4 cases) | **39/39** |
| **Full backend suite** | **5855 / 0 fail / 21 skipped** (X3 baseline 5839 + exactly the 16 new tests) |
| **Full web suite** | **1574 / 1574** (X3 baseline 1570 + exactly the 4 new tests) |
| `tsc --noEmit` (web) | clean |
| Lint regression gate vs branch origin | **NET_NEW 0/0** |

Gates NOT run, and why: staging UAT workflows (P7 blocker — pairing deliberately absent while
#194 is unmerged) and GitHub-hosted workflows without `workflow_dispatch` (steps reproduced
locally). No provider sandbox certification exists because no provider is selected — that
certification is defined as its own future receipt.

## Stop condition

Explicit consent precedes every provider call; face-match and liveness are separate
provider-provenanced assessments; the assessment never becomes the decision; historical
verification is intact; X3 lifecycle integrates correctly; no raw biometric/fingerprint store
exists; provider failure has a safe manual fallback. **X5 was not begun.**
