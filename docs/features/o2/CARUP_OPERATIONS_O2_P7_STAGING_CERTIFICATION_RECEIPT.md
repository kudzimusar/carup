# O2-P7 — People & Compliance Staging Certification Receipt (2026-09-04)

**Verdict: P7 PASS** on candidate `463507d1`, run **`33839364831`** — 21 passed / 0 failed
(6 mutating tests skip by design off the desktop project), three viewports.

## Entry conditions (all PO-authorized, all independently proven)

| Condition | Evidence |
|---|---|
| Accepted #194 base in O2 | merge `bb9d9900` contained; reconciliation `8c90cfc2` |
| Staging DDL parity | the SIX O2 migrations applied through the governed idempotent apply-list in the P7 workflow, with INDEPENDENT post-apply verification (tables/columns/nullability asserted, never inferred from an exit code) |
| Live-but-unledgered drift | `20260903120000` + `20260828203000` deliberately EXCLUDED from the apply-list — already live via the Serena gate's list; re-running correct DDL is not parity |
| Synthetic fixtures | per-run `p7.{applicant,dealer,outsider}.<run-id>@carup-staging.test` + a gate-owned reviewer, minted by the workflow; identity documents are generated SYNTHETIC assets (marker `SYNTHETIC TEST ASSET — NOT A REAL DOCUMENT`); no real document, no real PII; nothing accumulates and no other gate's fixture is touched |
| Preview pairing | exactly one additive row per map (authoritative Vercel branch aliases); no other candidate displaced |
| Exact-head pair | `frontend_sha == backend_sha == 463507d1`, `unpaired: false` |

## Journeys certified (§10 + §10-X)

X1 legacy verification surface stays retired (404/405, not merely gated) · X2 registration truth
(role-escalation refused at signup; profile persists/resumes; extraction never auto-approves;
candidate field-states honest) · X3 step-up + header-identity refusal on a security surface ·
X4 biometric consent with the provider **NOT CONFIGURED** and **no fabricated face-match or
liveness success** anywhere in the payloads · X5 dealer onboarding context gate
(`DEALER_ONBOARDING_CONTEXT_REQUIRED` for a non-business account), tenant-forgery refusal,
evidence privacy (no storage paths), applicant ≠ active Dealer, Dealer Compliance still
separately authoritative · X5A server-derived catalogue (forged query claims change nothing;
ungranted template refused; assistant registry-served and advisory; recent imports caller-scoped)
· X6 `identity_assurance.v1` truthful and artifact-free, canonical `who_must_act`, privacy-safe
notifications · P1-C outsider/former-seller denial · axe serious/critical = 0 on desktop, tablet
and mobile.

## Defects P7 found and closed (its entire purpose)

1. **Frontend preview had been failing to build since X5A** — two unused `React` imports;
   `tsc -b` enforces `noUnusedLocals` where the `tsc --noEmit` check used during X5A/X6 did
   not. The O2 preview alias was therefore stuck on an old commit. Fixed in `915f45c6`.
2. **500 on `GET /api/dealer-onboarding/overview`** — `dealer_profiles.id` is a uuid column
   while `user_id` is TEXT, so the id-first resolver made PostgreSQL raise 22P02 and the request
   failed instead of falling through. Mock-backed unit tests could not see it (a mock does not
   enforce column types). Fixed with a narrow cast-refusal fall-through + two regression pins
   that emulate PostgreSQL's refusal (`73344d6a`).
3. **Serious accessibility failures on the O2 surfaces** — muted text at ~3.6:1 on the dark
   cards, then light-on-light headers (pages set `text-gray-100` with no ground), then the
   shared `outline` Badge painting `text-foreground` on that ground. Fixed across
   `dc625239` → `73344d6a` → `463507d1`; the shared Badge variant was deliberately left alone.

Run trajectory: 11 → 14 → 18 → **21 passed**, each failure a real defect, none waived.

## Not done, deliberately

No production deploy. No live biometric provider. No PR #197 change. No Dealer activation
invented. No O2 merge.
