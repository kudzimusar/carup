# GMO-8 — Golden Journey, physical UAT · RECEIPT

**Status: PARTIAL.** Acts 1–2 PASS at three viewports (27/27). Acts 3–6 reach step 13 and stop
there. The blocker is no longer a vendor's billing balance: CarUp's governed OCR provider is
**Cloudflare Workers AI running `@cf/qwen/qwen3.8-27b`**, GMO has been converged onto that boundary,
and the remaining gap is that the staging preview holds no Workers AI token. The deployment says so
itself, fail-closed, and the harness refuses to certify against it.

> **One chronology.** Two Claude sessions wrote this lane concurrently and each recorded the same
> investigation, so this document was reconciled into a single account. Duplicated *narrative* was
> removed; **no evidence was.** The pre-reconciliation text is preserved verbatim at
> `evidence/GMO_8_RECEIPT_PRE_RECONCILIATION.md`.

---

## The acceptance sentence

> A completely new person registers through CarUp, completes governed provider-backed identity
> verification, is approved to operate a Garage, receives a canonical Garage tenant and founding
> membership, invites a new Mechanic, uses that newly-created relationship to complete a real
> Service Network job, and later revokes the Mechanic without erasing the resulting service
> history — with no SQL standing in for onboarding authority.

---

## 1 · Acts 1–2 — the applicant's own journey · **27 / 27**

Three viewports, both runs, no 5xx.

| step | desktop | tablet | mobile |
|---|---|---|---|
| 1 · an unprovisioned person registers as a Garage | ✅ | ✅ | ✅ |
| 2 · they reach their dashboard | ✅ | ✅ | ✅ |
| 3 · "Set up your garage" is reachable | ✅ | ✅ | ✅ |
| 4 · they start a garage application | ✅ | ✅ | ✅ |
| 5 · the page states that sending is NOT activation | ✅ | ✅ | ✅ |
| 6 · evidence does not require a registered company | ✅ | ✅ | ✅ |
| 7 · the send gate names what is missing, first | ✅ | ✅ | ✅ |
| 8 · a pending applicant has NO garage context | ✅ | ✅ | ✅ |
| 9 · the review queue is not reachable by an applicant | ✅ | ✅ | ✅ |

**The dead end is gone.** Registering as *Business → Garage / service centre* now leads somewhere
that is theirs — verified at the wire (`account_kind:"business", business_type:"garage"`). The live
evidence menu offers nine kinds, led by *"Photo of your workshop"*; company registration is present
and not required, so PO-2 survives deployment. The backend answers **401, not 404**, on all five GMO
route families — deployed proof they are mounted and gated.

Four measurement errors of mine cost six attempts here, every one the same shape — *a check that
could not see what it claimed to see*: a swallowed `.click().catch()` that silently produced an
`account_kind: individual` account; positional selectors broken by a conditional Province field;
an assertion that read a refusal as a pass because it guessed the copy; and a `register(page, who,
{business})` called with `{name, type}`, so the whole business branch was skipped **and the guard
meant to catch that lived inside the branch it was guarding**.

---

## 2 · Acts 3–6 — what is proven up to the block

`scripts/uat/gmo-8-acts-3-to-6.mjs`. Every step records **how** it was driven: `[browser]` a person
clicking the product, `[api]` a governed endpoint with a real session and real step-up, `[db]` a
readback only. The synthetic Operations reviewer's `users.role` is the **one** provisioned thing
(CarUp's own staff are provisioned by CarUp); it is recorded `PROV`, never `PASS`.

| # | how | step |
|---|---|---|
| 2 | api | synthetic identity evidence is rendered, not procedurally faked |
| 3 | browser | an unprovisioned person registers as a Garage |
| 4 | api | they hold a real session |
| 5 | browser | they fill in the application — **confirmed on the server**, not just on screen |
| 6 | api | the application exists and names no tenant |
| 7 | api | business-presence evidence attaches — a signage photo, no company papers |
| 8 | browser | they send it; status becomes `submitted` |
| 9 | api | the reviewer signs in and **steps up** |
| 10 | api | the application appears in the reviewer's queue |
| 11 | api | **approval is REFUSED while identity is unapproved — PO-2 enforced, not assumed** |
| 12 | api | the applicant submits identity verification through the governed endpoints |

Step 11 is the one worth pausing on: PO-2 is not a claim in a document here — the deployed product
refuses the approval, by name, and says why.

**Nothing constituting onboarding authority is provisioned.** No SQL in the harness creates a
tenant, a membership, an application, evidence or a decision.

---

## 3 · Why step 13 cannot be worked around — three independent refusals

Before accepting any block, I looked for a legitimate manual path, because *"a reviewer looks at the
document themselves"* is exactly what should happen when automation is unavailable. There isn't
one, and that is deliberate.

**The decision policy refuses.** `decisionPolicy._checkApprove` blocks APPROVE whenever the
session's stored `primary_reason_code` is a blocking one, and every document-quality code carries
`approveAllowed: false`.

**The reviewer's own judgement never reaches the check.**

```js
decisionPolicy.buildAssessmentSummary()
  const primaryReasonCode = session.primary_reason_code || classificationResult?.reasonCode || null;
```

The policy input is the code **stored on the session row**. A reviewer's own `reason_code` is
recorded on their decision and never consulted here.

**The lifecycle ledger refuses independently.**

```js
identityLifecycleService.js
  const APPROVAL_ONLY_STATES = new Set([LIFECYCLE_STATES.VERIFIED, LIFECYCLE_STATES.RECOVERED]);
  //  "States only the identity domain itself may enter, via the governed approval hook — a human
  //   transition endpoint cannot mint them, and the SUBJECT can never reach them at all."
```

The only writer of a capability-bearing state is `onVerificationApproved`, reached from
`decisionRecorder` **after** the policy has allowed APPROVE.

Two guards, one law: **no human hand-verifies an identity without evidence.** A third refusal came
from outside the codebase — the environment's own safety classifier blocked
`UPDATE garage_applications SET status='approved'`. The system does not want a governed status
forced, and it is right. Recorded as an OPEN O2 question in
`docs/features/o2/CARUP_OPERATIONS_O2_IDENTITY_PROVIDER_RESILIENCE_FOLLOWUP.md` and plan §12B —
**not** answered inside GMO.

---

## 4 · Act 6b — my own harness was measuring a proxy

The acceptance sentence ends *"…use that newly-created relationship to **complete a real Service
Network job**"*. My Act 6 step for it asserted that `/api/garage/queue` returned 200 and the mechanic
appeared in `/api/garage/mechanics`. That is *assignable* and *readable*. It is not a job. Had the
provider come up and the harness printed a full pass, it would have certified the sentence without
ever doing the thing the sentence is about — the same defect shape, in the step that matters most.

**Act 6b** now does the job through governed endpoints: publish the garage → a **fourth**
unprovisioned person registers, owns a car and asks that garage for service → the garage accepts and
opens a work order → the work is assigned to **the mechanic this journey created** → that mechanic,
not the founder, starts it, records the service and completes it → the customer sees a completed
case. Revocation then gained the half it never had: with a real Service Record in existence it
asserts the record **survives, still attributed** to the person whose authority just ended — plan
negative test 12, which until then had nothing to assert against.

**Its load-bearing assumption is measured, not assumed.** `assertVehicleAuthority` accepts
`vehicles.owner_id` and pointedly refuses `current_seller_id`. Reading `/api/vehicles/add` I first
concluded no product path set `owner_id` at all — which would have been a gap of the same shape as
the missing garage membership. **I was wrong**, and a probe on the deployed build settled it:

| # | probe | result |
|---|---|---|
| 1 | a non-business person registers through the product | account created, signs in, `role=owner` |
| 2 | `POST /api/vehicles/add` accepts the exact Act 6b body | **201** |
| 3 | an unknown garage slug is refused by name | 400 *"That garage is not accepting service requests"* |
| 4 | database readback | `owner_id = u_31a9c9…`, the new person |

`buildVehicleListingCandidate` sets `owner_id = userId` when the caller's role is `owner`. Probe rows
deleted and verified at 0.

**Acts 24–33 remain unmeasured.** They sit behind step 13.

---

## 5 · The Gemini investigation — HISTORICAL EVIDENCE, no longer the certification dependency

This section is preserved because it happened and because it found two real defects. **It is not the
current blocker.** CarUp's selected OCR provider is Qwen; GMO's direct Gemini dependency was stale
convergence drift, and §6 removes it.

**The provider was genuinely activated on staging**, twice, under explicit Product Owner
authorization. The one Gemini credential that exists across all four CarUp Vercel projects is
`type: sensitive` — Vercel returns its value to nobody, so it can never be copied between branches;
only its `gitBranch` binding is mutable. It was moved to this lane and restored, with the **complete**
pre-change record captured first and the restoration **verified field-by-field** against it
(`evidence/GMO_8_PROVIDER_BINDING_PRESTATE.json`). No value was ever read, printed or copied.
Production was untouched.

**Defect 1 — the vision client could not read a valid provider response.**
`askGeminiVision` took `data.candidates[0].content.parts[0].text` (the first part of a multi-part
2.5-series candidate is not guaranteed to be the text one) and then **discarded the response before
throwing**. A quota refusal, a safety block and a bug in our own parser all reached the compliance
reviewer's row as *"Malformed Gemini vision API response"* — pointing at the wrong party. The
identical pair sat in `askGemini` one function above. Both fixed; 5 tests, 4 mutations red. **That
fix is the only reason the real cause became legible.**

**Defect 2 — the submit step could not see the request it depended on.** `status is draft` covered
three faults at once: a `submit.isDisabled()` sampled once before autosave settled, a fixed 3.5s wait
that turned slowness into a false refusal, and never looking at the submit response. It now waits for
the button to enable, polls the state change for 30s, and prints what the endpoint actually
answered — or says the click produced no request at all. The next run passed it: `submitted (200)`.

**What the provider then said, every time:**

```
Gemini vision API 429: Your prepayment credits are depleted.
Please go to AI Studio at https://ai.studio/projects to manage your project and billing.
```

Roughly **nineteen independent live calls** across two sessions — eight recorded between
`22:01:57Z` and `22:18:04Z`, eleven more across three deployments including one built fresh after
re-binding the key — spanning about an hour after the project was reported funded. Not a cached
failure, not a stale build, not a rate limit. The wording is the **prepaid billing** model's.

Acts 3–6 were run at all three viewports in this state: steps 1–12 green (11 PASS + 1 PROV) on
desktop, tablet and mobile; step 13 a 429 each time; steps 14–33 blocked upstream.

**A nuance worth keeping.** `verification_ocr_provenance` has **no row** for any of these sessions,
which briefly looked like "the provider was never called". It *was* called — provenance is written
on the **extraction** path, and extraction never runs because classification failed first. The absent
row is the more visible signal and it points the wrong way.

**And a limit nobody could see past:** the key is `type: sensitive`, so no party — including the
owning account's own tooling — can determine which Google project it belongs to. A credential can be
valid, correctly wired, reaching the provider, and attached to an account nobody present can
identify. That is recorded as a sixth requirement in the O2 resilience follow-up.

---

## 6 · The owner's provider correction, and the convergence

**CarUp's governed OCR/document-vision provider is Cloudflare Workers AI running
`@cf/qwen/qwen3.8-27b`.** Llama is rejected (it fabricated eight identity fields from a landscape
photograph at confidence 1), Gemma is reserve, and there is **no automatic fallback**. GMO's direct
`askGeminiVision` import was drift from before that decision — and the consequence was concrete: a
governed identity decision had been made to depend on a vendor the owner never selected, and a
billing state on that vendor stopped garage onboarding outright.

### Repo-wide AI/OCR inventory (read-only, before changing anything)

| call site | feature | provider | shape | authority | action |
|---|---|---|---|---|---|
| `identity/documentClassifier.js` | **identity document vision** | Gemini **direct** | direct-vendor | O2 identity evidence | **CONVERGED** |
| `document-intelligence/documentIntelligenceService.js` | Document Intelligence | Gemini direct (text) | direct-vendor | observation | convergence debt — its own lane |
| `ai/aiServiceBus.js` | generic AI bus | Gemini direct (text) | direct-vendor | advisory | separate AI use — untouched |
| `marketplace/marketplaceAiAssistantService.js` | marketplace assistant | Gemini direct (text) | direct-vendor | advisory | separate AI use — untouched |
| `workbook/workbookAiAssistantService.js` | workbook assistant | Gemini direct (text) | direct-vendor | advisory | separate AI use — untouched |
| `dealer/workbookSemanticMappingService.js` | semantic mapping | Gemini direct (text) | direct-vendor | advisory | separate AI use — untouched |
| `operations/safeNarrationService.js` | safe narration | Gemini direct (text) | direct-vendor | advisory | separate AI use — untouched |
| `ai/analysisProvider.js` | vehicle-evidence analysis | Gemini-backed | direct-vendor | advisory | separate AI use — untouched |

Only one of these is OCR/document-vision. **Not every AI feature in CarUp must use Qwen** — the
decision enforced here is about the OCR/document-vision provider, and the rest were left alone.

### What was ported, and what deliberately was not

`fix/o2-live-ocr-operationalization` predates Service Network and GMO entirely — diffing this branch
against it shows both programmes as deletions — so **merging it was never an option**. Ported
minimally:

- `backend/services/ai/CloudflareVisionClient.js` — verbatim
- `backend/services/ai/ocrVisionProvider.js` — verbatim (the boundary, the rejected-model registry,
  `resolveCloudflareModel`, no fallback)
- `backend/tests/o2-cloudflare-ocr-provider.test.js` — **the boundary half only.** Eight tests that
  need the Document Intelligence schema layer stayed with their own lane: `documentSchemas.js` does
  not exist here and X7-8 keeps the legacy Document-Intelligence router retired.

`GeminiClient.js` is a **reconciliation, not a copy**: this lane's parser fixes stay, and the OCR
lane's `GEMINI_VISION_MODEL` export plus request options are added so the boundary's Gemini adapter
still works. Gemini remains implemented and selectable **by configuration** — removing it globally
was never the ask.

### What the classifier does now

Layer 2 asks `resolveVisionProvider()` and the file no longer names a vendor. The three-layer truth
boundary is unchanged: deterministic rejection → document-presence classification → extraction only
where classification permits. **A classification is a provider observation, never an identity
decision.**

**One image per call** is a measured constraint, not a style choice: the Workers AI vision models
accept a single image and *refuse* a second rather than dropping it. So each side is classified in
its own call. **The front governs; the back is genuinely read and recorded; a back that reads as a
non-document downgrades the pair** rather than riding through on a good front. Provider execution
evidence — transport form, the provider's own prompt-token count, image bytes sent, finish reason —
travels with the reading into `verification_assessments.risk_flags.provider_execution`, because
without it *"the model said non_document"* and *"the model never saw the image"* are the same row.

### Readiness stopped being about a vendor

`/api/health` now reports **`documentVision`**: the provider actually configured, its model, whether
it can run, what it requires, and whether mock is permitted. The UAT gate reads that and refuses a
mock-permitting deployment. `ocrProviders` keeps its name because an unrelated seller-autofill
surface reads it — renaming it to make a point about GMO would have broken a feature that has
nothing to do with this lane.

### Proof

13 convergence tests + 13 ported boundary tests. **Ten mutations red**: default flipped to gemini;
Qwen sent via the `inlineImage` form the model silently ignores; provenance hard-coded; the
unconfigured guard disabled; an unknown classification promoted to a positive; the back dropped; the
mock-permitted and unconfigured readiness gates disabled; `APPROVAL_ONLY_STATES` renamed; and its
guard bypassed.

**Two of those survived the first attempt**, because the assertions were substring greps — the guard
could be disabled with the word still present. The readiness rule is now a shared module the test
**executes** (`scripts/uat/lib/documentVisionReadiness.mjs`), and the lifecycle assertion is anchored
on the declaration *and* its use.

---

## 7 · Where the live journey stands

The deployed backend at the certification head reports, honestly:

```json
"documentVision": {
  "provider": "cloudflare",
  "model": "@cf/qwen/qwen3.8-27b",
  "configured": false,
  "requires": ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
  "mockPermitted": false
}
```

and the harness refuses to start:

```
HARNESS FAILURE: document-vision provider "cloudflare" (@cf/qwen/qwen3.8-27b) is NOT configured
                 — requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
```

That is the designed behaviour: **fail closed, no fallback to another vendor, no certification
against a provider that cannot answer.**

`CLOUDFLARE_ACCOUNT_ID` is already on the staging preview. **`CLOUDFLARE_API_TOKEN` is not** — it
exists as a GitHub Actions secret (added 2026-09-04), where the OCR lane's manual-dispatch workflows
use it. It is not a purchase and not a new account: it is a **credential placement**.

A live probe of the converged path against the real model is written and committed
(`scripts/uat/gmo-8-qwen-classification-probe.mjs` + `.github/workflows/gmo-8-qwen-classification.yml`,
**manual dispatch only** — a push trigger once turned an equivalent workflow into an unintended
consumer of the Workers AI daily allocation). It could not be dispatched: GitHub only lists a
`workflow_dispatch` workflow that exists on the **default branch**, and this lane must not modify
`main`.

### What closes GMO-8

1. Add **`CLOUDFLARE_API_TOKEN`** (the Workers AI token already in GitHub Actions secrets) to Vercel
   project `carup-backend-staging`, environment **Preview**. Nothing else changes; `CARUP_OCR_PROVIDER`
   and `CARUP_OCR_MODEL` keep their canonical defaults.
2. Redeploy the branch preview; wait for `documentVision.configured: true` at a paired head.
3. `GMO_REVIEWER=gmo8.reviewer.mtpwifxc@carup-uat.invalid node scripts/uat/gmo-8-acts-3-to-6.mjs
   --viewport=desktop` — then `tablet`, then `mobile`.

The synthetic Operations reviewer account is **deliberately preserved** for exactly this.

---

## 8 · Security and adversarial re-proof — GREEN

Re-executed against the **deployed** backend with the product's real transport (`x-session-token` +
double-submit CSRF), as a real platform-`owner` applicant:

| check | result |
|---|---|
| ordinary user reads the user table | **403** `Role 'owner' cannot access this resource` |
| `x-tenant-id` for a foreign tenant elevates to platform admin | **403** (×3 tenants) |
| `/api/users/management` + tenant header | **403** |
| `/api/admin/garage-applications` + tenant header | **403** |
| a foreign tenant grants a garage profile | **403** (×3) |
| a non-reviewer activates an application | **403** |
| a non-reviewer reads reviewer/garage surfaces | **403** (×3) |
| reviewer decision **without** step-up | **403 `STEP_UP_REQUIRED`** — before the resource is looked up |
| reviewer queue after step-up | **200** |
| **findings** | **0** |

An earlier pass of this probe scored several checks green on **404 "Route not found"** — a wrong path
always 404s, so that was a check that could not see what it claimed. The paths were corrected against
the harness's own route list and **404 was disqualified as a refusal**.

Stated exactly: **step-up gates the decision, not the queue read.** The queue returns 200 before and
after stepping up — reading a queue is not a decision, and claiming otherwise would have been false.

Live RLS on staging — all four GMO authority tables `ENABLE` **and** `FORCE`:

```
garage_applications · garage_application_documents · garage_application_decisions · garage_invitations
```

---

## 8b · Two writers, one lane — what actually went wrong, and what did not

Two Claude sessions wrote this branch and this staging database concurrently. Three consequences,
and only two of them are faults:

**A cancelled CI run.** `ci.yml` uses `concurrency: { group: ci-${{ github.ref }},
cancel-in-progress: true }`. On a pull request every run shares one group, so a new push cancels the
older run. **That is correct and must not be disabled**: the older commit really is obsolete, and
cancelling it is how the repository avoids certifying a head nobody will ship. What went wrong was
not the rule — it was that a second writer pushed a *different* commit while the first was being
certified. The repository already has the right defence for that (`Exact-head reference + staging
certification`); the missing one was single-writer discipline, and disabling `cancel-in-progress`
would have replaced a visible cancellation with a silent race between two green runs on two heads.

**A shared sensitive credential moved twice.** Both sessions rebound the same
`GEMINI_API_KEY` preview binding. It resolved correctly only because each recorded the pre-change
state and restored it. That is luck dressed as process.

**Overlapping fixture ownership — the real hazard.** Both sessions created `gmo8.owner.*` accounts
in one staging database. A cleanup written as `DELETE … WHERE email LIKE 'gmo8.owner.%'` would have
deleted the other run's live accounts, tenant and membership **mid-journey**, and that run would
have reported a product failure that was really this cleanup.

Closed: every run now has a **run id** (printed at startup, written to `report.json` as `run_id`)
which every persona it creates embeds, and `scripts/uat/gmo-8-cleanup.sql` may address only
resources carrying it. It covers the consequential tables — `tenant_users` explicitly, scoped by
*this run's tenant*, never by role or email pattern — refuses to run when the run id matches
nothing (a mistyped id must not read as a successful cleanup of zero rows), and does not touch
`storage.objects`. Two tests pin it, and three mutations turn them red: a pattern sweep,
`tenant_users` dropped from the cleanup, and the empty-match guard removed.

---

## 9 · Fixture cleanup, stated honestly

Run-owned **database** state deleted and verified at **zero** after every run: applications,
decisions, documents, verification sessions, notification queue, user sessions, tenant memberships,
accounts. The synthetic Operations reviewer is kept on purpose.

**Storage is DEBT, not cleanup.** 45 objects across five GMO-8 run prefixes remain in the private
`ocr-documents` bucket (277 objects in total, most predating this programme). The platform refuses
`DELETE FROM storage.objects` (`storage.protect_delete()`) and the Storage API needs a service-role
key this environment does not hold. **Weakening that protection to tidy synthetic test files would
be the worse trade.** Exact counts, prefixes, run ids and what an authorised cleanup needs:
`evidence/GMO_8_STORAGE_CLEANUP_DEBT.md`. Nothing here claims an object was deleted.

---

## 10 · Verdict

**GMO-8: PARTIAL.** Acts 1–2 PASS (27/27, three viewports). Acts 3–6 reach step 13. Acts 14–33,
including Act 6b, are written and unmeasured.

The blocker is a **credential placement on the staging preview**, not a purchase, not a billing
state, and not anything GMO owns. The provider is selected, the code is converged onto it, the
deployment reports its own unreadiness truthfully, and the harness refuses to certify against it.
