# V16 — Golden Vehicle Lifecycle Certification — Final Engineering Receipt

**Date:** 2026-08-29
**Phase:** V16 — Golden Vehicle Lifecycle Certification
**Engineering merge certification:** **PASS**
**Golden release / production activation:** **NOT CLAIMED — protected release gates remain**

## Certified immutable code candidate

This receipt certifies the product/source candidate:

`0b8435b08acf4b2c4967a4d9e63253202f9b289f`

PR: **#194 — Seller + Communications + Intelligence + Vehicle Passport convergence**

The receipt commit itself necessarily creates a new documentation-bearing PR head. That later head must be re-certified before the PR is marked ready; this file therefore treats the SHA above as the immutable **code candidate** and records the receipt-bearing head in PR #194 after this file is committed.

## Frozen source authorities

- canonical main anchor: `ba208963d863654157335189c60f587cbe330041`
- Seller / Marketplace #182: `cce3966c0539c6c38a6531e4b1d415eb91f19518`
- Communications #183: `507530aadff17ec8aa4830d3cb392efda6876031`
- Intelligence #185: `0b9fa0304878b3d16210db55fb2a3f7f1261f65d`
- Vehicle Passport #188: `3c4581386460b125842034f9e7c75628f7814e58`
- Vehicle Passport #188 base: `main` — stacked planning topology removed
- PR #187: closed as superseded documentation scaffolding

Seller #182 advanced after the earlier freeze. Its final three bounded changes were explicitly reconciled before this certification: the Guest Sell evidence-loader/lint correction, the stable “Any known damage” walk-around label, and the redesigned draft-copy staging assertion. The integration candidate was re-tested after that reconciliation.

## Exact-head engineering matrix

All substantive gates below ran on `0b8435b08acf4b2c4967a4d9e63253202f9b289f` and completed successfully.

| Gate | Run | Result |
| --- | --- | --- |
| Main CI — secret scan, dependency audit, lint regression, TypeScript, production web build, backend tests, migrations, Issue #101 PostgreSQL hardening/parity/public-key/post-cutover/ledger chain | `33219507883` | PASS |
| Vehicle Passport Foundation V1–V16 + PostgreSQL ownership/custody authorities | `33219507867` | PASS |
| Communications unit + PostgreSQL | `33219507910` | PASS |
| Navigation unit/structural + E2E + accessibility | `33219507901` | PASS |
| Diaspora backend/build + staging integration + Playwright | `33219507887` | PASS |
| Referral full web unit / TypeScript / backend / production build | `33219507907` | PASS |
| Marketplace exact-head reference + staging certification | `33219507920` | PASS |

Path-gated staging-write/UAT workflows that were skipped by this documentation/code path are not represented as PASS and are not used as evidence for the engineering decision.

## Exact staging provenance

Canonical staging deployments for the certified code SHA:

### Frontend

- project: `carup-staging`
- deployment: `dpl_EqUQzkAvz6fw5V1KSYKPNKCnafRW`
- branch alias: `carup-staging-git-integration-vehicle-passport-v16-cert-11-11.vercel.app`
- Vercel Git SHA: `0b8435b08acf4b2c4967a4d9e63253202f9b289f`
- state: **READY**

### Backend

- project: `carup-backend-staging`
- deployment: `dpl_FdAQ5sf9M2SqNcNDXabp5xsk43Ly`
- branch alias: `carup-backend-staging-git-integration-vehicle-pass-35ac1d-11-11.vercel.app`
- Vercel Git SHA: `0b8435b08acf4b2c4967a4d9e63253202f9b289f`
- state: **READY**

The Marketplace exact-head gate independently required the frontend runtime `/carup-provenance.json` commit SHA and paired backend URL to match this candidate, required backend `/api/health` build provenance to match, and only then executed the unmocked staging functional/visual certification.

Marketplace certification evidence:

- workflow run: `33219507920`
- evidence artifact: `9704697925`
- artifact name: `marketplace-certification-0b8435b08acf4b2c4967a4d9e63253202f9b289f`
- digest: `sha256:fa27467a0bb7ee4619be52b1099b693f0da69bfe148050b53b369ff2825a4846`

## Independent review gate

Immediately before the final review request:

- PR #194 head was still `0b8435b08acf4b2c4967a4d9e63253202f9b289f`;
- Seller #182 was still `cce3966c0539c6c38a6531e4b1d415eb91f19518`;
- both canonical staging deployments were READY on the exact code SHA;
- unresolved review-thread count was zero.

Final Codex review was then requested against **only** the exact code SHA.

Result: **CLEAN — no major issues found**.

- Codex result comment: `5458761911`
- reviewed commit: `0b8435b08a`
- unresolved P0/P1 review threads after review: **0**

## V16 authority/security closure represented by this candidate

The candidate now proves, at source/engineering level:

- one canonical VIN/Vehicle Passport survives governed ownership transfer;
- legal completion atomically changes owner authority and retires the stale Marketplace seller;
- a published listing becomes non-public on ownership completion;
- completed ownership history cannot be erased by ordinary cancellation;
- a post-completion dispute cannot fall back into pre-completion states; only governed uphold or a separate compensating transfer can resolve legal ownership;
- ownership lifecycle Communications payloads are privacy-minimized and do not disclose counterparty user IDs;
- Communications remains the durable routing/transport authority;
- Intelligence remains observation/advisory only and cannot mutate lifecycle authority;
- Seller taxonomy observations are RLS-enabled and browser-role-revoked;
- Issue #158 application runtime no longer persists ordinary plaintext private signing material;
- stakeholder public-key activation/rotation is serialized, atomic, and incarnation-safe, including `v1 -> v2 -> rollback-v1`;
- the repository continues to pass the inherited Issue #101 PostgreSQL security/parity chain;
- Golden A / Golden B sparse / adverse-P1 semantics fail closed rather than inventing evidence.

## Protected release gates deliberately kept separate

Engineering merge certification does **not** claim that production activation is complete.

The following remain protected/human release gates and must not be inferred from this receipt:

1. production Issue #158 aggregate population probe plus protected custody migration/rotation evidence;
2. production/staging Communications worker/provider secrets and real external delivery activation where required;
3. current receipt-bearing-head owner UAT sign-off;
4. post-activation soak with no P0/P1;
5. any protected production migration/environment approval.

Historical owner UAT on older SHAs remains regression history only. It is not silently inherited as current-head sign-off.

## Receipt decision

**CERTIFIED CODE CANDIDATE: PASS FOR ENGINEERING MERGE GATING.**

Next mandatory step: re-run the exact-head certification matrix on the documentation-bearing receipt commit, re-check Seller #182 and review threads, and only then mark PR #194 ready for review/merge.

**DO NOT CLAIM GOLDEN RELEASE / PRODUCTION ACTIVATION PASS UNTIL THE PROTECTED RELEASE GATES ABOVE ARE COMPLETE.**
