# O2 — Product Owner UAT RESULT

**Candidate walked:** `71b81d74` (the PR head at the time of the walk).
**Candidate certified:** `4002dbea` — the same tree plus the bounded closure of the three defects
this walk found. Nothing else changed between them.
**Verified before testing:** the runtime tree at the PR head is **byte-identical** to the certified
candidate `7eba353f` — `git diff --quiet 7eba353f 71b81d74 -- backend web database shared` is clean,
and the three commits between them are docs and UAT assets only. The pack's claim was checked, not
assumed.

**Deployed pair walked (O2's OWN preview, never GMO's or Service Network's):**

```
FE  carup-staging-git-feat-operations-o2-people-compliance-11-11.vercel.app
BE  carup-backend-staging-git-feat-operations-o2-peopl-b8a9c6-11-11.vercel.app
    both at 71b81d74 · unpaired:false · environment preview · approved staging Supabase · healthy
    ocrProviders {gemini:false, groq:false, openrouter:false, moonshot:false}
```

**Nothing from #197 or #209 was imported, invoked or relied upon.** The one provisioned thing is the
synthetic Operations reviewer's platform role, recorded `PROV` and never counted as a pass. Every
actor was created through the real signup flow; no SQL stood in for an O2 decision.

---

## Result

**First walk (`71b81d74`): 32 PASS · 1 FAIL** — the FAIL is the blocking step-up defect below, plus
the ownership-transfer error-vocabulary defect observed during B and the 393px overflow measured in J.

**Re-walk after the closure (`4002dbea`): 33 PASS · 0 FAIL**, 0 5xx, and 393px clean on all three
surfaces. Evidence at the end of this document.

| area | verdict |
|---|---|
| **A** registration / Progressive Trust | **PASS** |
| **B** ownership-transfer supersession (P1-C) | **PASS** |
| **C** People & Compliance operating view | **PASS** |
| **D** identity lifecycle & reviewer governance | **PASS except the step-up defect** |
| **E** dealer onboarding | **PASS**, with the activation boundary recorded |
| **F** workbook migration | **PASS** |
| **G** CarUp AI Workbook Assistant | **PASS** |
| **H** privacy / role separation | **PASS** |
| **I** Communications projections | **PASS** |
| **J** responsive | **PASS after the 393px fix** |

---

## Findings

### 1 · BLOCKING DEFECT — an identity decision required no step-up *(fixed)*

O2's most consequential action was reachable on role alone. Measured against a positive control on
the deployed candidate:

```
POST /api/admin/identity/verification-sessions/<ghost-id>/review   → 404 RESOURCE_NOT_FOUND
PATCH /api/admin/dealers/<ghost-id>/decision                       → 403 STEP_UP_REQUIRED
```

A ghost id is used deliberately: the guard, when present, fires **before** the resource is looked
up. The identity route reached the handler and looked the session up; the dealer route two files
away refused first. And on the *same* file, viewing the raw evidence was already step-up gated — so
the **less** consequential action was the better protected one.

A borrowed or stolen admin session could therefore approve a person's identity. **Fixed** with O2's
own established pattern: `requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE)`.

### 2 · DEFECT — a governed refusal was reported as a database failure *(fixed)*

`passport_begin_ownership_transfer_atomic` and its transition sibling raise a deliberate vocabulary:

| SQLSTATE | example | should be |
|---|---|---|
| `42501` | *only current owner or governance may initiate transfer* | 403 |
| `P0002` | *ownership transfer not found* | 404 |
| `23505` | *an active ownership transfer already exists for this vehicle* | 409 |
| `23514` | *governed current owner is required before transfer* | 409 |
| `22023` | *transfer id, target state and actor are required* | 400 |

Every one arrived as **HTTP 500 `DATABASE_ERROR: "Failed to begin/transition ownership transfer."`**
— telling the operator CarUp had broken when CarUp had *refused*, and discarding the reason it had
just been given. Observed twice during UAT B. **Fixed**: refusals are translated back into what they
are; a genuinely unexpected fault (e.g. `08006`) still raises `DatabaseError`.

### 3 · UX DEFECT — `/workbook-tools` overflowed horizontally on mobile *(fixed)*

At 393×852, `document.documentElement.scrollWidth` was **481** against `innerWidth` **393** — the
heading and four tabs would not wrap, and "Recent Imports" fell off the screen. **Fixed** by letting
the header row and the tab group wrap.

### 4 · KNOWN DEFERRED — LIVE OCR is NOT READY on this preview

Confirmed exactly as the UAT pack already records it. Uploads accepted, submit 200,
`ocr_execution_status: null`, **no field of any kind extracted**, no provider provenance,
`failure_reason: "Classification provider unavailable."`, `primary_reason_code:
DOCUMENT_NOT_VISIBLE`, session `pending_manual_review`, identity **not** verified.

**Nothing was fabricated** — no name, no number, no confidence score — and the product routed to
human review with an honest reason. That is the truth model holding under a provider outage.

This is an environment/provider-activation gap, not a product claim that fails: **the product does
not claim OCR works.** It is closed by the Qwen/Cloudflare provider boundary that arrives with
#209, which is a further argument for the parent-first order rather than a reason to hold #208.

### 5 · KNOWN DEFERRED — dealer activation has no governed path, and the product says so

The task set the deciding test: **if the UI told the user they were an active dealer when no
authority existed, BLOCK.** It does not.

- `/dealer/onboarding` makes no activation claim of any kind.
- `/dealer` does **not** admit the applicant — the browser is redirected away.
- `/workbook-tools` lists `dealer vehicle inventory` under **"Not available to this account (and
  why)"** with the reason *"Needs a registered business context"*, and the garage/mechanic workbooks
  under *"Not available yet — Service Network reconciliation required"*.

Approval is honest about being approval. **Boundary recorded, not a blocker.**

---

## Evidence for the areas that passed

**A · Registration.** A brand-new synthetic person registered through the real flow and received
`role=owner` — signup grants no privilege. The journey is served by
`GET /api/registration/journey`, not reconstructed in the browser; a saved profile survived a full
sign-out and fresh login. A fresh account never claims usable identity assurance.

**B · Ownership transfer (P1-C).** Two brand-new people, a vehicle created through the product, and
the transfer driven through the governed endpoints. Completion is governance-only (`403
INSUFFICIENT_PERMISSIONS: "Governance authority is required to complete ownership transfer"` for the
owner) and transitions demand a **CRITICAL** step-up. The state machine was walked as the product
defines it (`initiated → under_review → complete`). After completion:

| probe | before | after |
|---|---|---|
| vehicle in the former owner's `/api/vehicles/me` | yes | **no** |
| vehicle in the new owner's list | no | **yes** |
| former owner's seller authority | `recognized` | **`revoked`**, basis `null` |
| former owner publishing the vehicle | — | **403** *"You do not have owner, current-seller, or organizational scope"* |
| `vehicles.owner_id` | former | **new owner** |
| `vehicle_ownership_history` rows | 1 | **2** — the acquisition and the transfer, both retained |

Not a UI-only disappearance: measured at the API and read back from the database.

**C · People & Compliance.** The review is served from real state and names the person it describes.
Email verification, identity, seller authority and dealer compliance appear as **separate** facts —
no merged "verified" badge. No document images, storage paths or OCR payloads appear in the
aggregate. An unknown person returns 404, not a silent empty 200 that would read as "nothing
outstanding".

**D · Identity.** Evidence submitted through the governed endpoints never makes the account
verified; the applicant cannot review their own case (403).

**E/H · Authority separation.** With a positive control proving the refusals are real and not
missing routes (`/api/registration/journey` → 200 for the same actor): individuals and dealer
applicants are refused platform user management, the dealer review queue and the dealer decision
route (403 each); a client-supplied `tenant_id`, `role` and `status: approved` were all ignored and
the server derived its own; a foreign `x-tenant-id` grants nothing.

**F/G · Workbook.** An individual is offered their own listings catalogue and is *told* what is not
available and why. The assistant is described as proposing while the human decides, and is never
described as approving or verifying anything.

**I · Communications.** No notification carried a document, a storage path or a base64 payload.

**J · Responsive** — seven widths × three surfaces, `scrollWidth <= innerWidth + 1` and a visual
check:

| width | 393 | 820 | 1024 | 1280 | 1366 | 1440 | 1536 |
|---|---|---|---|---|---|---|---|
| `/onboarding` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/workbook-tools` | ✅ *(after fix; 481>393 before)* | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/dealer/onboarding` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Console: only transient cold-start `Failed to fetch` on unrelated widgets
(`/notifications/me`, `/marketplace/my-recommendations`). **Zero 5xx** across the whole UAT.

---

## Harness honesty

Nine failures in the first passes were **mine, not the product's**, and are recorded because the
pattern matters: a payload missing its `{ profile: … }` envelope; a business-type label that read
`Dealership` where the product says `Dealer / dealership`; a missing `x-idempotency-key` the product
named explicitly; camelCase where the API takes snake_case; vehicle routes that do not exist
(`/api/vehicles/:vin`, `/api/vehicles/mine`); a state-machine jump the product forbids; synthetic
images that compressed below the evidence floor; and — three separate times — an assertion that
matched a **comment** and reported the code as doing the thing the comment warns against.

In every case the product's error message said exactly what was wrong. None of these was reported
as a product defect.

---

## Post-fix re-verification — the fixed candidate, re-walked

The three fixes were pushed as one bounded closure (`4002dbea`), the preview pair redeployed, and the
**same** harness re-run against it with **fresh** accounts — not replayed from the first walk's state.

```
FE  carup-staging-git-feat-operations-o2-people-compliance-11-11.vercel.app
BE  carup-backend-staging-git-feat-operations-o2-peopl-b8a9c6-11-11.vercel.app
    both at 4002dbea · unpaired:false · environment preview · approved staging Supabase · healthy
```

**Fix 1 re-measured live, with its positive control:**

```
POST  /api/admin/identity/verification-sessions/<ghost-id>/review  → 403 STEP_UP_REQUIRED   (was 404)
PATCH /api/admin/dealers/<ghost-id>/decision                       → 403 STEP_UP_REQUIRED
```

The ghost id still matters: 403 before a lookup that would have 404'd proves the guard fires ahead of
the resource, which is where it has to fire.

**Full re-walk:** `O2 OWNER UAT (desktop): 33 PASS · 0 FAIL`, `5xx 0`, one transient cold-start
console error on an unrelated widget.

**Fix 3 re-measured** — the surface that overflowed, at the width it overflowed at:

| width | surface | scrollWidth | innerWidth |
|---|---|---|---|
| 393×852 | `/onboarding` | 393 | 393 |
| 393×852 | `/workbook-tools` | **393** *(was 481)* | 393 |
| 393×852 | `/dealer/onboarding` | 393 | 393 |

---

## Certification at `4002dbea`

| gate | result |
|---|---|
| exact-head CI on #208 | **15 success · 4 skipped · 0 failure** |
| `Lint · Types · Build · Tests` | **success** — lint regression gate, web typecheck, web build, backend tests, migration verification |
| Backend suite (in CI) | **`# tests 5955 · # pass 5934 · # fail 0 · # skipped 21`** |
| `Passport foundation contracts` (carries `migration-integrity.test.js`) | **success** |
| Web unit suite (local, settled machine) | **1,585 / 1,585 across 164 files** |
| `tsc -b` | **exit 0** — the project-reference build, not `tsc -p web/tsconfig.json`, which checks nothing |
| Vercel builds | `carup`, `carup-staging`, `carup-backend`, `carup-backend-staging` — all success |

The three fixes are held by `backend/tests/o2-owner-uat-closure.test.js` (10 tests). Each guard was
mutation-tested before being cited: five deliberate reversions, five red.

---

## Verdict

**O2-USABLE — OWNER ACCEPTED.** Ready for parent-first merge authorization.

O2 passed on its own authority. Nothing was imported from Service Network (#197) or from
garage/mechanic onboarding (#209) to make it pass; no SQL stood in for an O2 decision; no biometric
provider was activated; production was not touched and nothing was merged.

Two boundaries are recorded rather than closed, because in both cases **the product does not claim
the capability it lacks**: LIVE OCR is not ready on this preview (no provider configured — closed by
#209's governed provider boundary, which is downstream in the parent-first order), and dealer
activation has no governed path and the UI says so plainly.
