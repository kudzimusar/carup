# O2 — Post-Ready Automated Review Closure (2026-09-08)

**This is a THIRD, separate event. It does not amend the first two, and neither is rewritten:**

| # | event | when | outcome |
|---|---|---|---|
| 1 | **Product Owner UAT** | 2026-09-07 | 3 defects found and closed → `4002dbea`; verdict recorded in `CARUP_OPERATIONS_O2_OWNER_UAT_RESULT.md` |
| 2 | **Independent approval** | 2026-09-07 | `11-eleven-skm` approved PR #208 at `7fe1f821` |
| 3 | **Post-Ready automated review** *(this document)* | 2026-09-08 | Marking the PR Ready triggered a Codex review that opened **8 threads on `7fe1f821`**. All eight reproduced. All eight are closed here. |

**Consequence for the merge candidate:** `7fe1f821` is now **historical**. It carried five P1 and
three P2 defects and must no longer be described as the final merge candidate. Runtime changed, so
the approval at `7fe1f821` **predates the runtime being offered** and a fresh independent review is
required — GitHub keeps the tick because stale reviews are not dismissed on this ruleset, and that
tick is not evidence about the new code.

---

## Why a green suite did not catch any of this

Three of the five P1s (C4, C5, C7) are **database** facts, and the X5A suite's in-memory client
enforces **no unique index and no column type**. Its dispatch stub also returned
`{ vehicle: { id: 'veh-1' } }` — a shape `POST /api/vehicles/add` has never produced. The suite was
green because it was agreeing with the code rather than with PostgreSQL.

Closure therefore added `database/test/o2_workbook_receipt_identity_check.mjs`, which runs the real
migration DDL in PGlite and is **now a CI step**, plus a service-level client that enforces exactly
the two constraints the migrations declare. Every guard below was mutation-tested: the fix was
reverted and the guard went red first.

---

## Findings and disposition

### C1 · P1 · **CONFIRMED — FIXED** · missing client step-up flow

`grep -rn "step-up\|step_up\|stepUp\|STEP_UP" web/src` returned **0 matches** while the backend has
`POST /api/auth/step-up` and **nine** `requireAuthenticationAssurance` guards across six route
files. A normal login leaves `step_up_at` unset, so every guarded action — identity decision,
dealer decision, seller-authority review, ownership-transfer transition, lifecycle change,
revoke-other-sessions — answered `403 STEP_UP_REQUIRED` and no screen could satisfy it. The gap
predates the owner-UAT closure; that closure widened it to the identity decision route.

**Fix.** `stepUpSession()` on the API client, a `StepUpDialog` component, and a `runGuarded()`
runner that catches `STEP_UP_REQUIRED`, prompts for the password, and **retries the same action
with the same payload**. The guard is untouched: it still decides, and a second refusal is
surfaced, not swallowed. Cancelling leaves the action undone.

**Tests.** `PeopleComplianceReview.postready.test.tsx` — prompt appears; retry is byte-identical
(`Object.keys(retryPayload)` asserted, so no role/tenant/capability is added); failed step-up
neither retries nor closes; cancel does not retry; a second refusal re-prompts.
**Mutation:** removing the `STEP_UP_REQUIRED` branch → **6 red**.

### C2 · P1 · **CONFIRMED — FIXED** · wrong identity decision payload

The screen sent `{ action, notes }`. `reviewVerificationSession` reads
`reasonCode|reason_code`, `internalNote|internal_note|reviewNotes|review_notes` and
`applicantMessage|applicant_message|retryReason|retry_reason` — and **nothing named `notes`**.
`VerificationDecisionRecorder` then refuses a rejection without a reason code, and a resubmission
request without a reason code *and* an applicant message. So reject and request-resubmission failed
validation every time; approve and escalate succeeded with the reviewer's words discarded. The
pre-existing `IdentityVerificationCaseManagement.tsx` on the same codebase already sent the correct
shape — this screen simply did not.

**Fix.** A reason-code selector (from the shared `REASON_CODE_LABELS` vocabulary), an applicant
message field and an internal note field; the payload is now
`{ action, reasonCode, internalNote, applicantMessage }`. The API-client type was corrected too, so
the failing shape is no longer expressible. **Backend validation was not weakened.**

**Tests.** reject sends `reasonCode` and no `notes`; a reason-less rejection never reaches the
service; resubmission carries both required fields; escalate keeps the note.
**Mutation:** restoring `notes` → **4 red**.

### C3 · P1 · **CONFIRMED — FIXED** · unsupported dealer decision

"Pass review" submitted `pass_review`. `dealerComplianceService.DECISIONS_ALLOWED` is
`approve_requirement · reject_requirement · request_more_info · restrict · suspend · reinstate ·
set_expiry`. The primary positive dealer action could only ever throw.

**Fix.** No vocabulary was invented. A dealer passes review by **approving each named requirement**,
which is the grain the ledger and the requirement rows already use — so the requirement list now
carries per-row Approve / Request more info / Reject, each sending `requirement_key` (the service
refuses those verbs without it), and the profile-level Restrict / Suspend / Reinstate keep their
own row and send no key.

**Tests.** no control submits `pass_review`; every verb sent is in the governed set; the positive
action carries its `requirement_key`; profile-level decisions carry none.
**Mutation:** restoring the button → **1 red**.

### C4 · P1 · **CONFIRMED — FIXED** · workbook receipt unique-key collision

`uq_diaspora_workbook_receipt_row` is `(batch_id, row_number, attempt)` and **excludes
`sheet_name`** — verified against the migration and re-verified in PGlite by reading
`pg_index`. The evidence receipt and the vehicle receipt for the same row used the same three
values, so the bulk insert raised `23505` **after** both mutations had run, and the batch status
was never updated.

**Fix.** The receipt grain is the workbook row, which is what the schema says: evidence is carried
in the row's `metadata` and is not an import row of its own. One receipt per row per pass; the
evidence outcome is recorded on that receipt (`EVIDENCE_PARTIAL`) and returned **in full, per item**
in the result, so nothing is lost. The unique constraint was **not** dropped. And a receipt-write
failure no longer prevents the batch status update — the mutations already happened, so the batch
must reflect reality; `receipts_recorded` states whether the audit trail landed.

**Tests.** PGlite proves the collision and that the new model replays cleanly; the service guard
asserts one receipt per key and the per-item evidence detail.
**Mutation:** restoring the second receipt → **2 red**.

### C5 · P1 · **CONFIRMED — FIXED** · partial-import retry reused attempt 1

A `PARTIALLY_IMPORTED` batch is explicitly retryable, and every retry wrote `attempt: 1` again —
colliding with its own first pass, so the batch could never leave the partial state.

**Fix.** `attempt` means "which pass over this row produced this receipt", the same meaning the
diaspora confirmed-import service already gives it (its compensation pass writes attempt 2).
`buildAttemptAllocator` reads the batch's existing receipts once and issues `max + 1` per row. A
read failure raises **before** any mutation, because silently restarting at 1 is the collision this
exists to prevent.

**Tests.** retry yields attempts `[1,2]` and reaches `IMPORTED`; a third pass yields `[1,2,3]` —
history is additive, never overwritten.
**Mutation:** hardcoding `attempt: 1` → **2 red**.

### C6 · P2 · **CONFIRMED — FIXED** · dealer BUSINESS/BRANCHES rows discarded

`VEHICLE_TEMPLATE_SHEETS[DEALER_VEHICLE_INVENTORY]` is `['BUSINESS', 'BRANCHES', …VEHICLE_MODULES]`
and `resolveRowValues` field-validates all of them, but persistence is built only from
`validation.vehicles`. A dealer could fill in business and branch details, see `IMPORTED`, and have
nothing read them.

**Disposition: deliberately non-persistent, and now SAID SO.** Writing them would let a spreadsheet
edit a dealer's own application — authority that belongs to governed dealer onboarding and nowhere
else (X5: workbook claims never create authority). So the truth model was corrected instead: each
supplied row raises a `SHEET_NOT_IMPORTED` warning naming dealer onboarding as the real destination,
`totals.notImportedRows` counts them, and both the dry run (**before** the user confirms) and the
execution result carry `notImported` / `not_imported_sheets`. They are warnings, not errors,
because the vehicles in the same file remain importable.

**Tests.** three supplied rows produce three warnings, a two-sheet summary and a count of 3; the
seller template invents nothing. **Mutation:** dropping the declaration → **1 red**.

### C7 · P2 · **CONFIRMED — FIXED** · VIN written into a uuid column

`vehicles.vin` is the **primary key** — a vehicle has no uuid at all — and the real
`POST /api/vehicles/add` 201 returns a top-level `vin` with no `vehicle` object. So
`response.body?.vehicle?.id` was always undefined, `entityRef` fell through to the VIN, and the VIN
was written into `diaspora_workbook_import_rows.target_record_id`, which is `uuid`. PostgreSQL
refused it with `22P02` and **nothing checked the error**, so every real import left the row
unlinked while the mock's fabricated `vehicle.id` made the path look healthy.

**Fix.** `target_record_id` is written only when the identifier really is a uuid; otherwise it stays
null and the row keeps its existing, correct link — `workbook_record_id` (text VIN). The update
error is no longer ignored: a failure lands on the receipt as `TARGET_LINK_FAILED`.

**Tests.** the real response shape leaves the uuid null and the VIN on the receipt; a genuine uuid
IS still linked, so the fix is not "never link". **Mutation:** restoring the fallback → **1 red**.

### C8 · P2 · **CONFIRMED — FIXED** · read model hid database errors

`rows(result)` returned `[]` for any result whose `data` was not an array — exactly Supabase's
failure shape. Seven parallel queries were unchecked, so a fault in seller authority, ownership,
transfers, sessions or tenant membership produced **HTTP 200 with that section empty**. Worse than
Codex described: a `dealer_profiles` fault became `is_dealer: false` — not an empty section but a
positive claim that the person is not a dealer.

**Fix.** Every constituent fails **closed**. There is no section here whose emptiness is decoration:
each one carries authority or the absence of it, and "holds none" versus "could not find out" lead
to opposite decisions. The read raises `PEOPLE_REVIEW_SECTION_UNAVAILABLE`, the route answers **503
naming the section**, and the reviewer is told which part is unavailable.

**Tests.** six separate injected failures each refuse instead of returning 200; a healthy client
still builds the review, so the guard is not a blanket refusal.
**Mutation:** restoring the empty-array helper → **6 red**.

---

## What did NOT change

* **No migration, no DDL, no schema change.** Every fix works inside the existing contract.
* No provider or configuration change; **no biometric provider activated**.
* Production untouched; `main`, #197 and #209 untouched; nothing merged.
* No backend validation weakened, no unique constraint dropped, no guard removed.
* No GMO/#209 or Service Network/#197 code imported.

---

# Round 2 — fresh automated re-review of `87684c6a` (2026-09-08)

A **fresh** Codex review was requested on the closure head and reviewed `87684c6ae6` at
2026-09-07T20:04:10Z. It opened **six new P1 threads**. All six reproduced. This is the fourth
event in the sequence, and it does not amend the three above.

**`87684c6a` is now historical.** Two of the six show that the round-1 C1 fix, while correct in
its own terms, was **not wired to reality** — a recurring failure mode in this repo, and the
reason both a mechanism test and a *wiring* pin now exist.

### D1 · P1 · CONFIRMED — FIXED · the step-up code never reached the caller

`apiClient` treats **every** unsafe 403 as a possibly-stale CSRF token and retries once. A genuine
403 therefore arrives through the RETRY path — and that path copied `status` and `data` but **not
`code`**. So `error.code === 'STEP_UP_REQUIRED'` was `undefined` for every real API call: the
prompt could never open and both identity and dealer decisions still dead-ended.

The round-1 tests passed because they reject with a hand-made error that carries `code`, never
touching `apiRequest`. **Fix:** one `buildApiFailure()` used by both failure paths, so they cannot
drift again. **Guard:** `apiClient.stepUpCode.test.ts` drives the real retry path. **Mutation:** 1 red.

### D2 · P1 · CONFIRMED — FIXED · the recovery existed on one screen only

`StepUpDialog` was used solely by `PeopleComplianceReview`. The **primary** identity console
(`IdentityVerificationCaseManagement`) called the guarded review and evidence-preview routes
directly. Checking the same class across the codebase found **two more**: `DealerCompliance`
(dealer decision) and `VehicleOperationsReview` (seller-authority review).

**Fix:** the recovery became a shared `useStepUpGuard()` hook, adopted by all four screens; the
decision retry reuses one idempotency key so a step-up retry replays the same decision rather than
minting a second. **Guards:** four behavioural tests plus a **wiring pin** that fails by name when a
screen calls a guarded client function without the guard. **Mutation:** un-wiring the console → 1 red.

### D3 · P1 · CONFIRMED — FIXED · imports could not reach the routes they replay

`server.js` skips `app.listen` when `process.env.VERCEL` is set, so the deployed backend has **no
listener on 127.0.0.1** and the loopback dispatch could reach nothing. In an ordinary Node
deployment the request also omitted `x-csrf-token`, which the globally mounted `csrfMiddleware`
refuses before routing. The injected test dispatcher hid both.

**Fix:** `resolveDispatchBaseUrl()` returns an explicitly configured base URL
(`CARUP_INTERNAL_API_BASE_URL` / `CARUP_PUBLIC_API_URL`), a loopback URL only where a listener
really exists, and **null** on Vercel; the dispatcher now mints and sends a real CSRF pair. When no
base is reachable the execution **refuses up front** — nothing mutated, batch untouched — instead
of marking every vehicle `DISPATCH_FAILED` and finalising. **Mutation:** 2 red.

### D4 · P1 · CONFIRMED — FIXED · an evidence failure still reported a finished import

`IMPORTED` is terminal: `alreadyImported` short-circuits every later execution. A failed evidence
upload only annotated the receipt, so the batch was finalised, the UI reported zero failures, and
the missing evidence became permanent and invisible. **Fix:** an evidence failure keeps the batch
`PARTIALLY_IMPORTED` — which *is* accepted for retry — and the result carries `evidence_failed`,
`retryable` and `incomplete_reason`. **Mutation:** 1 red.

### D5 · P1 · CONFIRMED — FIXED · a batch was finalised after its receipts were lost

Round 1 stopped a receipt failure from throwing, but still wrote `IMPORTED` from mutation outcomes
alone, so the missing per-row audit could never be repaired — and `WorkbookWorkspace` never showed
`receipts_recorded=false`. **Fix:** unsaved receipts keep the batch retryable, and the workspace now
states the shortfall and re-enables the run. **Mutation:** 1 red.

### D6 · P1 · CONFIRMED — FIXED · retries duplicated already-recorded evidence

A retry replays every accepted row, including rows whose evidence already succeeded.
`withUploadIdempotency` **fails open** without a key, and the evidence payload supplied none.
**Fix:** a deterministic `workbook-evidence:<batch>:<row>:<index>` key — stable across retries,
distinct between items. **Mutation:** 1 red.

### Still unchanged

No migration, no DDL, no schema change. No provider or config change beyond *reading* an optional
base-URL variable. Biometrics not activated. `main`, #197 and #209 untouched. Nothing merged.

---

# Round 3 — independent read-only audit of `87684c6a → 6f850163` (2026-09-08)

The third Codex review was **unavailable (review quota)**, so the gate was met a different way: an
independent read-only audit of the actual diff and the affected runtime contracts. It found
**three P1 blockers**. All three reproduced. `6f850163` is now historical.

Every one is the same species as D1/D2: a change that is correct read on its own, and wrong against
the real contract it has to satisfy — hidden by a test dispatcher that answered `201` to anything.

### E1 · P1 · CONFIRMED — FIXED · workbook evidence had no MIME type

**Reproduced against the real validator**, not by reading: the exact body
`executeVehicleWorkbookImport` builds has no inline `file` and no `mime_type`, so
`isSupportedMimeType(null)` is `false` and the canonical route's
`else if (!isSupportedMimeType(mimeType)) throw` refuses it — **`Unsupported file type: unknown`**.
Every workbook evidence reference would have failed in production. The D4 success test hid it
because its dispatcher returned 201 without running the evidence contract.

**Fix — a declared column, not a guess.** `EVIDENCE_NOTES` gains a **required** `file_mime_type`
whose vocabulary is **imported from the owning module** (`evidenceService.allowedMimeTypes`), never
retyped. The allow-list was **not** broadened, the evidence endpoint was **not** weakened, no second
writer was created. Deriving the type from the URL's extension was rejected — that would make a
filename into evidence truth — and fetching the URL server-side to sniff it was rejected outright:
arbitrary outbound requests are an SSRF and privacy surface that must not arrive as a side effect of
a workbook fix.

**Proof:** supported image succeeds · supported PDF succeeds · missing MIME refuses *and the batch
stays `PARTIALLY_IMPORTED`* · unsupported MIME refuses with the allow-list unchanged · the dry run
raises `REQUIRED_MISSING` **before** the user confirms · evidence stays PENDING (the workbook sends
no `verification_status`/`verified`/`trust_score`) · a retry reuses the same idempotency key and does
not duplicate. **Mutations:** dropping `mime_type` → 5 red; making the column optional → 2 red.

### E2 · P1 · CONFIRMED — FIXED · the mutation target was not proven to be this candidate

`CARUP_PUBLIC_API_URL` is the canonical **public, stable** origin — on staging documented as
`https://api-staging.carup.dev`. It proves nothing about which deployment or Git SHA answers it, so
a branch-preview import could have created vehicles and evidence **on stable staging**.

**Fix — fail closed on candidate identity.** `CARUP_PUBLIC_API_URL` is no longer accepted as a
mutation target at all. The resolver takes an operator-set `CARUP_INTERNAL_API_BASE_URL`, or
Vercel's own immutable **per-deployment** `VERCEL_URL` (not `VERCEL_BRANCH_URL`, an alias that
moves), or a loopback URL only where `app.listen` really ran. Then, **before the first mutation**,
`assertDispatchTargetProvenance()` reads the target's `/api/health` and compares `commit_sha` and
`branch` against the caller's own provenance — reusing the existing governed mechanism
`backend/config/buildProvenance.js`, whose rule is already that unknown provenance is a failure.
**No new environment variable is required:** `VERCEL_URL` is injected automatically.

**Proof:** same candidate allowed · stable staging refused · production refused · same SHA on a
different branch refused · missing provenance refused on either side · unreachable target refused ·
on Vercel with no self-target **zero mutations** and the batch untouched · loopback still supported.
**Mutations:** re-accepting the public URL → 1 red; skipping the provenance proof → 3 red.

### E3 · P1 · CONFIRMED — FIXED · the replay lost the actor's organisational scope

`authorizeRole` derives tenant scope separately from the session: it reads `x-tenant-id`, verifies a
real `tenant_users` membership (403 without one), and only then sets `userContext.tenantId`.
`buildVehicleListingCandidate` reads exactly that — for a dealer, `tenant_id = ctxTenant` and
`current_seller_type = 'Dealer'`. The dispatcher forwarded only `authorization`, `x-session-token`
and `cookie`, so an active Dealer's import replayed as a **tenant-less** listing.

**Fix.** `trustedActorHeaders(actor)` re-expresses the **already-validated** scope, and is built at
the **execution boundary** rather than inside one transport — because the previous shape lived
inside the HTTP dispatcher where an injected test dispatcher never saw it, which is how a dealer
losing its tenant survived a green suite. The separation is kept intact: the session proves the
person, membership proves the organisation, the inner route re-verifies both, and the workbook
grants nothing it was not already proven to hold. `x-user-id` is explicitly never forwarded.
The comment claiming the internal CSRF request behaves "exactly as the browser" was **corrected** —
the binding genuinely differs.

**Proof:** Owner → owner-scoped draft, no tenant · Dealer + valid tenant → Dealer-tenant-scoped
draft · Dealer without a tenant refused · forged tenant refused by the inner membership check ·
cross-tenant writes blocked for vehicle **and** evidence · evidence replay keeps the same tenant ·
`x-user-id` never sent. **Mutation:** dropping the trusted context → 2 red.

### Still unchanged

No migration, no DDL, no schema change (the new workbook column is a spreadsheet field, not a
database column). No Vercel configuration written. No provider config change. Biometrics not
activated. `main`, #197 and #209 untouched. Nothing merged.

---

# Round 4 — F-round independent re-audit of `6f850163 → 23d4bfa3` (2026-09-08)

Three more contract failures, plus **four corrections to my own certification claims**. All
reproduced. `23d4bfa3` is now historical.

### F1 · P1 · CONFIRMED — FIXED · the workbook classification contract did not match the canonical one

**Reproduced with the real `validateEvidenceUploadPayload`, both cases:**

| row | canonical validator | workbook (before) |
|---|---|---|
| `registration` + **blank** subtype | **REFUSED** — *"evidence_type is required (or provide evidence_class + evidence_subtype)"* | **ACCEPTED** |
| `registration` + `export_yard_photo` (an **import**-class subtype) | **REFUSED** — *"Subtype 'export_yard_photo' is not valid for class 'registration'."* | **ACCEPTED** |
| `registration` + `registration_book` | ACCEPTED | ACCEPTED |

Canonical-first means `Boolean(class && subtype)`. The workbook made the subtype optional and gave
it a vocabulary **flattened across every class**, so both broken shapes passed the dry run and
failed at upload — after the vehicle had already been created.

**Fix.** `evidence_subtype` is **required**, and the dry run now **calls
`validateEvidenceUploadPayload`** per evidence row, attaching
`EVIDENCE_CLASSIFICATION_INVALID` to that VIN with the taxonomy's own message. No legacy
`evidence_type` column was added (that would bypass the requirement rather than meet it), no
subtype is inferred or chosen, and no second taxonomy exists. The flat vocabulary remains
advisory-only — a spreadsheet cell cannot be conditioned on another cell — and the **real** check
is the class/subtype compatibility test run by the owning module.

**Mutations:** skipping the classification check → 2 red; making the subtype optional → 1 red.

### F2 · P1 · CONFIRMED — FIXED · the dry run enforced no evidence upload authority

The route runs `canUploadEvidenceRecord(normalized, activeRole)` after validation; the dry run ran
nothing. Reproduced against the **owning matrix**, which really does refuse:

- `auction/auction_sheet` — owner **false**, dealer true
- `dealer_listing/*` — owner **false**, dealer true
- `registration/police_clearance_first_registration` — a **subtype-level override**: owner false,
  dealer false, **government true**, admin true

**Fix.** The dry run normalizes each row through the canonical validator and evaluates
`canUploadEvidenceRecord` with the **server-derived** actor role, raising
`EVIDENCE_ROLE_FORBIDDEN` on the affected VIN. The message says *"a permission rule, not a file
problem — importing again will not change it"*, so a deterministic 403 is never presented as a
retryable fault. No evidence role was widened, no workbook permission matrix exists, and the
workbook grants nothing.

**Mutation:** dropping the authority check → 4 red.

### F3 · CONFIRMED — catalogue corrected · Admin had no listing subject

**Reproduced:** an ordinary platform Admin yields `owner_id: null, tenant_id: null,
current_seller_type: null` → **ineligible**, `missing_owner_for_private_listing |
unknown_seller_type`. Yet the catalogue offered `seller_vehicles` and promised *"drafts under your
own listing authority"* — an authority that actor does not have.

**Disposition.** No `owner_id`/`tenant_id` field was added to the spreadsheet. Instead the gate
moved from the **role** to the **listing subject**: an owner is one, a dealer's tenant is one, and
an Admin or Government account is one **only when it genuinely holds a tenant** — which the
existing `buildVehicleListingCandidate` already supports (`tenant_id = ctxTenant`, seller type
`Dealer`, eligible). That existing governed context is used and proven; **no admin delegation was
invented.** An Admin without one now gets `no_listing_subject` and a plain explanation.

**Mutation:** re-advertising to any admin → 2 red.

### F4 · certification-integrity corrections — my own claims, corrected

These were overstatements in the E-round receipt. Each is now either proven properly or withdrawn.

- **F4a — "real evidence validator".** The old `contractDispatch` called only
  `isSupportedMimeType` and I described it as the real evidence validation. It was not. The
  boundary now **invokes** `validateEvidenceUploadPayload`, `canUploadEvidenceRecord`,
  `isSupportedMimeType`, `buildVehicleListingCandidate` + `getListingEligibility`, the tenant
  membership rule, and `withUploadIdempotency`. Nothing is paraphrased.
- **F4b — Admin proof.** The E-round receipt claimed an Admin-bounded proof that no committed test
  contained. A real one now exists (F3/F4b), covering both the ordinary Admin and the
  tenant-holding Admin.
- **F4c — the PENDING assertion was vacuous.** It checked a *reduced log object* for keys the
  logger never copied, which is true of any key. It now inspects the **actual outgoing body**,
  serialized, for `verification_status` / `verified` / `is_verified` / `trust_score` / `trust` /
  `review_outcome` / `reviewed_by` / `decision`, and asserts positively that the body carries only
  reference facts.
- **F4d — idempotency wording.** A stable key is not deduplication. The test now runs
  `withUploadIdempotency` over a **shared store and a shared evidence table across two passes**:
  first pass `deduped: false`, retry `deduped: true`, and **one** evidence record after both.

Turning the boundary honest immediately exposed more of my own fixture debt — synthetic VINs and
`u1`-style ids that the real eligibility contract refuses as `fixture_excluded | seed_owner_id`.
Those fixtures are now realistic identities, so the tests reach the stage they claim to test.

### Still unchanged

No migration, no DDL, no schema change. No Vercel config. No provider change. Biometrics not
activated. `main`, #197 and #209 untouched. Nothing merged. **Every E1–E3 closure preserved**:
MIME required and imported, no filename guessing, no URL sniffing, `CARUP_PUBLIC_API_URL` still
forbidden as a mutation target, immutable `VERCEL_URL` self-target, SHA/branch provenance before
mutation, fail-closed on unknown provenance, tenant reconstruction from the validated actor, inner
membership re-verification, `x-user-id` never forwarded, CSRF behaviour unchanged, stable evidence
idempotency keys.

---

# Round 5 — G-round audit findings, and the H-round closure (2026-09-08)

An independent read-only audit of the F-round closure returned **RE-AUDIT FAILED** with
**2 P1, 4 P2 and 2 P3**. Every one is closed here. `d2229a5e` is historical.

## The corrections to what earlier rounds claimed

These stand as corrections, not erasures. The earlier text above is left intact.

| earlier claim | what was actually true |
|---|---|
| "dry run mirrors canonical classification/authority" | True **at the dry run only**. Execute re-validated nothing, so the protections were advisory. Dry-run parity never implied apply parity. |
| "Admin-with-tenant authority is genuinely canonical" | Weaker than stated. `buildVehicleListingCandidate` honoured a *header-validated* tenant and an *unvalidated body* tenant identically, so role alone could assert a subject. |
| "the boundary calls the canonical contracts" | `contractDispatch` is **test-only scaffolding**. It proves the workbook's payload satisfies those contracts; it proves nothing about production composition. |
| "a retry does not duplicate" | Proven **sequentially**. Two concurrent retries could both miss and both insert — a stable key is not concurrency safety. |
| "the subtype vocabulary is imported from the owning module" | Imported, but **malformed**: `Object.keys` over an array of objects produced `["0","1","2",…]`, so the advisory list contained no real subtype at all. |

## G-1 → closed · execute is now the authority boundary

**DRY RUN MAY EXPLAIN. EXECUTE MUST AUTHORIZE.** A persisted batch is a data snapshot, never a
capability token. `executeVehicleWorkbookImport` now, **before the first write for each row**,
re-derives from the CURRENT actor: the listing subject and its eligibility
(`buildVehicleListingCandidate` + `getListingEligibility`), the evidence classification
(`validateEvidenceUploadPayload`), the content type (`isSupportedMimeType`) and the upload
authority (`canUploadEvidenceRecord`). It also applies `requireTemplateAction` against the
batch's **server-owned** template type — execute was the one workbook mutation route with no such
gate. A refused row now mutates **nothing**: the G-round's "forbidden evidence still creates the
vehicle" is closed because every deterministic check for a row completes before any write for it.

Data snapshot frozen; authority fresh.

## G-2 → closed at the canonical listing authority

**This changed a pre-existing certified contract, and that is stated rather than slipped through.**
`backend/tests/vehicle-create-eligibility.test.js` asserted *"admin listing with an explicit real
owner_id is eligible"* under the heading *"known-limitation coverage"*. The G-round classified that
limitation as a P1 authority defect, so the test encoded the vulnerability. It now asserts the
closed contract — a body-supplied `owner_id` or `tenant_id` grants nothing — alongside a new
positive control proving an admin with a **validated** tenant context still lists through it. CI
caught this: the H-round's first push was RED on exactly that assertion.


`buildVehicleListingCandidate`'s admin/government branch no longer reads `body.owner_id` or
`body.tenant_id`. Role alone grants no listing subject; the tenant comes only from the
server-validated context `authorizeRole` established. A conflicting body value is ignored rather
than rejected, so an over-eager client cannot break a legitimate submission. Every caller of the
canonical create benefits, not just the workbook.

## G-3 → closed · the subtype vocabulary carries real codes

Derived from the taxonomy's own objects: **68 codes**, `registration_book` and
`export_yard_photo` present, no numeric indices, no duplicates. The list stays **advisory** — a
spreadsheet cell cannot be conditioned on another cell — and the help text now says CarUp makes
the class/subtype decision at import rather than implying the dropdown enforces it.

## G-4 → closed · the harness is described accurately

`contractDispatch` is a **test composition harness** proving the workbook-generated payload can
satisfy the canonical component contracts. New `o2-h-round-closure.test.js` drives the real
`executeVehicleWorkbookImport` composition for the production-path claims.

## G-5 → closed · concurrency-safe idempotency

The race is settled where it must be — in the database.
`20260908120000_vehicle_evidence_upload_idempotency.sql` adds `idempotency_key` and a **partial**
unique index (only rows that carry a key), following the repo's own stock-ledger precedent, so
legitimate evidence history stays unconstrained. `withUploadIdempotency` now treats a unique
violation as "a concurrent request already created this" and returns the winner.
**The migration is NOT applied anywhere by this closure** — the apply is a separate, independently
gated Product Owner decision.

## G-6, G-7, G-8 → closed

A government account now receives an explicit `dealer_vehicle_inventory` disposition with a
truthful reason instead of vanishing from the catalogue; the catalogue tests use fixtures that
actually reach the dealer-context and verified-trade-role branches; the route header comment now
states where execute's gate really lives.

## Fixture debt this exposed

Making execute authorize immediately failed several older suites — fixture VINs, `u1`-style ids,
evidence rows with no subtype or MIME, and batches whose template the executing actor was never
entitled to. Every one was a fixture that could not reach the state it claimed to certify. They
are now reachable identities with canonically complete rows.

## Still unchanged

No Vercel config, no provider change, biometrics not activated, `main`/#197/#209/production
untouched, nothing merged. One additive migration written and **not applied**.

---

# Round 6 — I-round closure (2026-09-08)

The independent I-round audit of the H closure returned **RE-AUDIT FAILED — 2 P1, 4 P2**.
All closed here. `75dd17fd` is historical.

Both P1s are the same species, and it is worth naming: **a fix that is correct in its own terms
and disconnected from the thing it was supposed to affect.** One wrote a constraint the writer
never fed; the other read a fact that did not mean what it was taken to mean.

## I-1 → closed · the constraint now sees the key

**Reproduced against real PostgreSQL**, with the branch's own migration DDL and the canonical
writer's insert shape:

```
✓ a top-level key DOES trigger the unique index — the migration is structurally valid
✓ the key lands ONLY in metadata; the indexed column is NULL
✓ two application-shaped rows with the same key are BOTH accepted — the race was NOT closed
```

`insertData` in `vehiclesRoutes.js` set `metadata.idempotency_key` and never the column, so the
partial predicate `WHERE idempotency_key IS NOT NULL` excluded every real row and the H-round's
recovery branch was unreachable. The H-round "proof" threw its own `23505`.

**Fix.** The canonical writer now persists the key into `vehicle_evidence.idempotency_key`, which
is the **canonical** location; `metadata.idempotency_key` is retained as a **compatibility mirror**
so the historical corpus stays findable by the same lookup, and the lookup reads column OR
metadata. There are not two authorities: nothing reads metadata in preference to the column.

**Rolling-deploy safety, both directions.** The migration is applied nowhere, so new code may meet
an old database. A `42703` (undefined column) on the key write — **that one condition only** —
degrades to the pre-migration insert, so ordinary uploads keep working; RLS, foreign-key and
validation failures propagate untouched. Old code against a migrated database simply leaves the
column NULL. Neither order breaks uploads.

**Scoped recovery.** `isIdempotencyUniqueViolation` matches `uq_vehicle_evidence_idempotency_key`
by constraint name (falling back to the name in the message). An unrelated `23505` — a primary-key
clash, say — must never become a silent success handing back another row's id.

**Real proof.** `o2-i-round-closure.test.js` runs the migration in PGlite and drives two genuinely
concurrent `withUploadIdempotency` calls through the real writer: **one row, both callers the same
evidence id, exactly one told it deduped.** Also proven: different keys make different rows;
second-item-on-a-row, different-batch and different-VIN uploads are never suppressed; a pkey
violation and FK/RLS/not-null errors all propagate; a pre-insert failure claims no key so the
retry creates once; and a cold cache still dedupes durably.

## I-2 → closed · membership is not commerce authority

The H-round kept `tenant_id = ctxTenant` for admin/government and **certified it with a positive
control**. The audit asked the question the H-round did not: *what governed fact means "this actor
may sell as this Dealer tenant"?*

The answer is that none exists. `authorizeRole` sets `tenantId` on the existence of **any**
`tenant_users` row, and that table's own DDL comments its role column as `'admin', 'manager',
'member'` — a garage mechanic is a member too. `getListingEligibility` consults no dealer profile,
compliance state or activation. And O2's own boundary records that **Dealer activation has no
governed path yet**.

**Fix — fail closed.** Role alone grants no listing subject and neither does bare membership. A
genuine `dealer` effective role (a governed platform role) still lists through its validated
tenant. Everything else yields a null subject. No Dealer activation was invented; the catalogue
was realigned to mirror the same rule.

**Authority matrix, measured:**

| actor | subject | eligible |
|---|---|---|
| Owner | own id · Private Owner | ✅ |
| Dealer + validated tenant | tenant · Dealer | ✅ |
| Dealer, no tenant | none | ❌ |
| Admin + tenant-admin / manager / mechanic / member | **none** | ❌ |
| Admin, no tenant · Government + tenant | none | ❌ |
| any forged body `owner_id` / `tenant_id` / `current_seller_type` | none | ❌ |

**Two earlier tests asserted the wrong thing and were inverted, not deleted** — the H-round
positive control and the F-round "Admin who genuinely holds a governed tenant" case — so the
history of the mistake stays legible.

## I-3 → I-7

- **I-3** PR body updated to the new candidate with the full seven-SHA history preserved.
- **I-4** H15 relabelled **"handler-level"** and honestly scoped; the database-backed proof is I-1's.
- **I-5** the receiving-side guarantee is now asserted on the real canonical constants as well as
  the outgoing body.
- **I-6** the malformed `workbookRoutes.js` header comment repaired.
- **I-7** authority is now proven through the **real `authorizeRole` middleware** — session →
  platform role → `tenant_users` membership → effective role — not a hand-built actor. This
  required an **additive** `supabaseClient` seam on `authorizeRole`; production passes none and
  uses the singleton exactly as before. Scope stated plainly: middleware-derived, not HTTP
  transport.

## Migration gate — unchanged and explicit

`20260908120000_vehicle_evidence_upload_idempotency.sql` is **applied nowhere**. Until it is
applied under separate governance, the running system has only the sequential guarantee. **No
receipt may claim deployed concurrency safety**, and none does.

---

# Round 7 — the J-round

Six findings against `9014cca0`. Each was reproduced against the running code before anything was
changed; the reproduction output is quoted where it is the point.

## J-1 — the real writer destroyed the 23505 before the guard could see it

The I-round's concurrency proof used a test writer that threw the **raw driver error**. The
deployed writer does not: it ended in `throw new DatabaseError(insertError.message)`, and
`DatabaseError` sets `.code = 'DATABASE_ERROR'` and carries no constraint. Reproduced through the
canonical translation on real PostgreSQL:

```
ok       -> ev-1 deduped=false
REJECTED -> DATABASE_ERROR / HTTP 500 :: duplicate key value violates unique constraint "uq_vehicle_e…
isIdempotencyUniqueViolation(DatabaseError) = false
```

The loser of a genuine race got a **500**. The index was doing its job; the application threw the
evidence away.

Closed with `toDatabaseError`, which raises the same public error — same message, same status, same
serialized body — while preserving the driver's `code` and `constraint` on a **non-enumerable**
`cause`. Nothing new is exposed to a client.

Closing it surfaced a **second** defect in the guard itself: `error?.code || error?.cause?.code`
short-circuits on the wrapper's own truthy `'DATABASE_ERROR'` and never reads the native code. Both
levels are now read. The J suite caught this — it was not visible by inspection.

The load-bearing test drives the same propagation shape as `insertEvidenceFromRequest`: two real
concurrent writes, one row, one dedupe, both callers on the same id, neither a 500 — and an
unrelated 23505 (a second unique index), an FK violation and a CHECK violation all still propagate
as ordinary database errors.

## J-2 — a client-supplied key in a global namespace

The migration constrained `(idempotency_key)` alone while the endpoint accepts a **client-supplied**
key. Reproduced on real PostgreSQL:

```
same actor, VIN-B with VIN-A's key -> id=ev-101 deduped=true vin=VIN-A
DIFFERENT actor, same raw key      -> id=ev-101 deduped=true vin=VIN-A
rows created for 3 distinct legitimate uploads = 1
```

So one actor's raw string suppressed another's upload **and handed back that other actor's evidence
id and VIN**.

The migration cited `diaspora_stock_ledger` as its precedent and then failed to follow it. CarUp's
convention for a client-supplied key is already scoped everywhere it appears —
`diaspora_stock_ledger (stock_item_id, idempotency_key)`, `diaspora_workbook_import_batches
(tenant_id, uploaded_by, idempotency_key)`, `diaspora_usage_reservation (tenant_id, feature_key,
idempotency_key)`. The index is now **`(uploaded_by, idempotency_key)`**, and the contract is:

| | |
|---|---|
| same actor · same key · same VIN | dedupe |
| same actor · same key · **different** VIN | **409 conflict**, never a silent cross-resource return |
| different actor · same raw key | independent namespace — no suppression, no leak |
| key with no actor to scope it to | fail **open** (a duplicate is a lesser harm than suppressing someone else's upload) |

The in-memory fast path is scoped identically, so it cannot collapse two actors either. Metadata
remains a compatibility mirror for the historical corpus and is **also** actor-scoped on read.

## J-3 — a dealer role plus generic membership minted Dealer authority

`authorizeRole` sets `userContext.tenantId` from `x-tenant-id` on the existence of **any**
`tenant_users` row, and with no `x-stakeholder-role` the effective role is the platform role. So:

```
platform dealer + MECHANIC membership in a Garage
  -> seller_type=Dealer  tenant_id=tenant-garage-1
```

The I-2 comment names this hazard for the `else` branch and closed it there. The `dealer` branch —
one line above — still took `ctxTenant` unconditionally. I-2 was not closed.

**The authority already existed and was not invented.** `dealer_profiles` carries both `user_id` and
`tenant_id`, is indexed on the tenant, is queried by tenant, and its own service states the
contract: tenant binding *"is derived server-side from a governed organization relationship or stays
null until one exists"* — which is why X5 deliberately excluded `tenant_id` from the client-editable
fields. `resolveDealerListingSubject` reads exactly that binding.

Two questions are kept apart: **who the seller is** (this module) and **whether the draft may be
published** (`deriveCanPublish`, untouched). Publication compliance is not required to own a private
draft. Withdrawal *is* a subject question, so a suspended dealership yields no subject.

**HONEST BOUNDARY — no product path writes `dealer_profiles.tenant_id` today.** On current data this
resolver therefore grants **no dealer** a listing subject. That is the correct fail-closed answer and
it matches O2's already-documented boundary that no governed path converts an approved applicant
into an active Dealer. Dealer activation is **not** invented here.

`/api/vehicles/add` and workbook execute resolve the identical subject through the identical
function, so the two mutation surfaces cannot drift. Execute re-resolves at execute time, so a
dealership withdrawn after the dry run cannot still import.

## J-4 — the catalogue advertised what execute would refuse

`hasListingSubject = role === 'owner' || role === 'dealer'` promised "drafts under your own listing
authority" to a dealer with no tenant and to a dealer whose only tenant was an unrelated Garage —
for both of whom execute now deterministically refuses. The catalogue consumes the **same** resolved
subject rather than forming a third opinion, and a dealer without a dealership is told why in the
words of their actual situation.

## J-5 — the route-level proof

The I-round invoked `authorizeRole()` by hand and then called the candidate helper. That shows the
pieces agree; it does not show the request path uses them. J-5 drives real HTTP into the real
router, through the real middleware, into the real service:
Owner · governed dealership · dealer with no tenant · dealer with a mechanic membership · foreign
tenant · forged tenant · admin with generic membership · forged `x-user-id` · a role-escalation
attempt · a withdrawn dealership. The database double **refuses** a dealership query that is not
scoped by both `user_id` and `tenant_id`, so a weaker resolver fails there rather than passing.

## J-6 — CI truth

The PR body claimed `15 success · 4 skipped · 0 failure`. That was stale. It now states the measured
result, including any red staging check and its diagnosis from **this** head.

## Certification-integrity cleanup

`uploadIdempotency.js`'s header had described "no migration required", metadata as the durable
authority, and a unique index as a future recommendation — for three rounds after that design was
replaced. It now describes the actual architecture and its migration gate. A stray `0x00` byte,
introduced in the I-round and invisible in review, was found in that file (it made `grep` treat the
source as binary) and removed; every file this round touched was scanned for control bytes.

## Migration gate — unchanged

`20260908120000_vehicle_evidence_upload_idempotency.sql` is **applied nowhere** — not staging, not
production — and its unique contract was corrected on the branch precisely because it is unapplied.
**Deployed concurrent idempotency is NOT certified** until the corrected migration is separately
applied and verified on staging.

---

# Round 8 — the K-round

Six findings against `83201244`. Each reproduced before anything changed.

## K1 — the writer had a rolling-deploy fallback; the reader did not

Staging has **no `idempotency_key` column** (verified directly). The durable lookup's SELECT named
it anyway, so PostgREST failed the whole query, `lookupBySupabase` returned null, and the
metadata dedupe that existed *before* the column was authored stopped working. Reproduced on a
pre-migration database:

```
first upload           -> ev-1 deduped=false
metadata carries key   -> "K"
lookupBySupabase COLD  -> null      <- should have found ev-1
retry after restart    -> ev-2 deduped=false
rows for ONE operation -> 2
```

On Vercel that "restart" is one cold start. The J-round protected the write path and regressed the
read path.

Closed with a **narrow** compatibility read: the canonical column-and-mirror lookup runs first, and
**only** a genuine missing-column condition (42703 / schema-cache) falls back to a metadata-only
query that names no absent column. RLS, auth, malformed filter, FK, syntax and network errors all
still degrade to "treat as new" and never reach the fallback — asserted for five distinct codes,
each also asserting the fallback was **not** attempted.

## K2 — a key bound to a vehicle, not to an operation

`settle()` compared only VIN. Reproduced: same actor, same VIN, same key, but
`auction_sheet`/`SUM-B` against a stored `registration_book`/`SUM-A` →

```
upload B -> ev-101 deduped=true
persisted -> [{"evidence_type":"registration_book","checksum":"SUM-A"}]   <- B was DISCARDED
```

The fingerprint is `evidence_class`, `evidence_subtype`, `evidence_type`, `checksum` — **existing
columns the route already writes**, no second taxonomy, no volatile presentation metadata. A
mismatch on any one of them is a **409**, never a silent substitution. The in-memory cache stores
the operation too, so the fast path is not a bypass.

**Compatibility rule, stated because it is a deliberate weakening:** a field is compared only when
*both* sides supply it. A historical row that never recorded a column cannot contradict anything,
so the floor is the J-round's VIN-scoped behaviour and never worse; every field either side does
supply makes it stricter. On staging, 169 evidence rows carry `evidence_type` 100%, class 89%,
subtype 83%, checksum 88% — and **zero** carry an idempotency key at all, so the compatibility
surface is currently empty.

## K3 — the J-round disabled every real Dealer

Measured read-only on staging: **14** platform-dealer users · **5** holding a tenant membership ·
**4** dealer profiles · **0** profiles carrying a `tenant_id`. Making
`dealer_profiles(user_id, tenant_id)` the sole subject was secure and also a live regression from
`main`, not deferred onboarding.

**The governed fact CarUp already had is the organisation.** All five real Dealer memberships are `admin` of an **active** tenant — but only **four** of
those tenants are inside the dealer vocabulary `{dealer, dealership}` (3 `dealer` + 1 `dealership`);
the fifth is an `import` tenant and is deliberately excluded (L3). Both inputs are
genuinely server-controlled — an audit of the candidate tree found **zero backend writes** to
`tenants` or `tenant_users`: no route, no service, no RPC. The only INSERTs in the repository are
seed statements in migration 002. A client cannot create a tenant, set its type, or mint a
membership.

The authority is now a composition, every part required:

| # | fact | keeps out |
|---|---|---|
| 1 | effective role `dealer` | everyone else |
| 2 | validated `tenant_users` membership | forged tenants |
| 3 | membership role acts for the business (`owner`/`admin`/`dealer`) | **a mechanic employed by a dealership** |
| 4 | `tenants.type` ∈ `{dealer, dealership}` | **a garage** |
| 5 | `tenants.status` active | a wound-up organisation |

Requirements 3 and 4 are both load-bearing: type alone would let a dealership's mechanic sell;
membership role alone would let a garage admin sell. `dealer_profiles(user_id, tenant_id)` is
retained as an **additional** grant, and a suspended profile withdraws authority by either path.

`{dealer, dealership}` is CarUp's own vocabulary (`DEALER_SELLER_TYPES`), not a new one.
**Deliberately excluded and reported rather than decided quietly:** tenant type `import` (4 tenants,
one with a platform-dealer admin) — it denotes the diaspora import business and is not in that
vocabulary; and membership role `manager`, which no current Dealer holds. Both can be admitted by
an explicit product decision.

**Blast radius of the change itself:** exactly **one** vehicle in staging carries a `tenant_id`
(a `dealership` tenant) and **zero** vehicles have a Dealer seller type.

## K4 — the catalogue promised an import it would refuse

`dealer_vehicle_inventory` was `role === 'dealer' → active:true` with the full action list, and told
applicants that "imports create DRAFT vehicles under your own listing authority".

The root cause was one coarse verb: `import` gated inspect, mapping/confirm, dry-run and both
assistant routes **as well as** execution, so the catalogue could only advertise execution it would
refuse or withhold preparation it allows. The action contract is now refined —

* **`prepare`** — inspect, map, dry-run, assistant. Reads and validates; creates nothing.
* **`import`** — execute. Requires a real listing subject.

Availability is unchanged (preparation is legitimate work); the **action list** narrows, and the
prose says the same thing the machine-readable list does.

## K5 — the route proof now includes the production identity

The J-round proof is kept and **relabelled accurately** as *router + `authorizeRole` under the test
`x-user-id` fallback*. A new suite authenticates every case with a real `user_sessions` token:
owner · legitimate dealer + dealership · dealer against a non-dealership tenant · tenant the session
does not belong to (403) · expired · revoked · unknown token · spoofed stakeholder role · and a
session-only route proving an asserted `x-user-id` cannot replace a session where policy forbids it
(with the positive control, so the negative means something).

## K6 — governance text

The standing approval at `7fe1f821` is corrected to **eight** superseding candidate heads behind
`83201244`, and nine after this round. The full SHA history is preserved.

## Recorded, deliberately NOT fixed in this PR

Both belong to other lanes and are logged here only so they are not lost:

1. **`staging-integration` has no `timeout-minutes`.** During the database outage it hung for
   **78 minutes** instead of failing fast, and would have run toward GitHub's 6-hour default. That
   job lives in the Diaspora workflow.
2. **The marketplace readiness gate reads `supabase.status` and discards it**, so it admits a
   deployment whose database is down. Not smuggled into O2.

---

# Round 9 — the L-round

## L1 — the fingerprint did not cover remote evidence

The route hashes only INLINE files, so a remote submission — exactly what the workbook evidence
path sends (`file_url`, classification, MIME, key, **no checksum**) — stores `checksum = NULL`.
Reproduced:

```
upload A (FILE-A.pdf, checksum null) -> ev-1
upload B (FILE-B.pdf, checksum null) -> ev-1 deduped=true
persisted -> [{"file_url":".../FILE-A.pdf"}]      <- FILE-B silently discarded
```

Closed by adding a **stable remote reference** derived from storage identity CarUp already writes:
`storage_bucket` + `file_path` (which the route defaults to the URL). Nothing is fetched, so no URL
is ever dereferenced and no SSRF surface is created.

* A signed URL's query string carries a signature and expiry that change per issue for the SAME
  object, so it is stripped — otherwise a legitimate retry would look like a new file.
* **Case is preserved.** Object keys are case-sensitive; the vocabulary fields (class/subtype/type)
  are still compared case-insensitively because they are a controlled vocabulary.
* **Content outranks location.** When both sides carry a checksum, the checksum decides — the same
  document re-uploaded to a new key is the same evidence. The reference decides only when there is
  no content identity to decide it, which is exactly the remote case.

## L2 — Dealer authority was not propagated to existing seller mutations

K3 fixed CREATION and left every existing-vehicle seller mutation on raw tenant equality.
Reproduced on the real routes with a platform `dealer` who is only a MECHANIC in a dealership, on a
vehicle they neither own nor sell:

```
A. K3 CREATION -> granted=false  reason=membership_not_business_authority
B. publish 200 · unpublish 200 · reprice→99999 200 · set status Sold 200
```

**Inventory — every consequential seller/commerce surface, not just the ones named:**

| surface | disposition |
|---|---|
| `PATCH /api/vehicles/:vin/status` | gated |
| `loadScopedVehicle` → `publish`, `unpublish`, `price` | gated (one helper, three routes) |
| `assertEvidenceOwnershipScope` → evidence upload | gated (composes with `canUploadEvidenceRecord`) |
| `mediaRouter` `/upload/vehicle`, `/upload/document`, `/upload/signed-url` | gated |
| `mediaRouter` `/document/signed-url` (private document read) | gated |
| `server.js` existing-Passport seller reuse in `/api/vehicles/add` | gated |
| `PATCH /api/vehicles/:vin/seller-draft` | gated |
| `hasExistingSellerRelationship` (shared recognition primitive) | tenant clause now requires an explicit governed decision, default **false** |
| `mechanicIsAssignedToVehicle` (Service Network) | **deliberately untouched** |
| `/api/partsentry/add` | **deliberately untouched** |
| `resolveVehicleObjectAuthority` (lender/insurer/eligibility) | **recorded, not changed** — object access, not seller authority |

One primitive, `hasGovernedDealerVehicleAuthority`, consuming exactly the facts
`resolveDealerListingSubject` uses, so creation and lifecycle cannot drift. It is consulted **only**
after owner and current-seller have failed, which keeps the seller's own hot path at zero added
queries — the publish/price routes documented that as load-bearing after a Golden lifecycle run came
within a minute of its timeout.

Verified after the fix: dealership **mechanic** → 403 on publish/reprice/status; dealership **admin**
→ 200 on all three.

A **tripwire** fails the suite if raw seller tenant-equality reappears in any guarded file, and a
second test asserts Service Network keeps its own tenant scope.

## L3 — corrected staging baseline

The K wording said all five Dealer memberships were dealer-typed. Corrected: all five are `admin` of
an **active** tenant, but only **four** are inside `{dealer, dealership}` — 3 `dealer` + 1
`dealership`. The fifth is `import` and stays excluded. **Continuity blast radius: 4 of 5 retain
listing authority; 1 does not.** `import` and `manager` remain excluded pending a Product Owner
decision.

## Database authority — verified, and the audit's reason corrected

The re-audit reported "no anon/authenticated/PUBLIC table grant" on `users`/`tenants`/`tenant_users`.
Measured directly, that is **not** why they are safe: browser roles **do** hold
SELECT/INSERT/UPDATE/DELETE grants on all three. **RLS is what denies them** —

* `users`: RLS enabled, **0 policies** → denied entirely;
* `tenants`: RLS enabled, **1 SELECT-only** policy;
* `tenant_users`: RLS enabled, **1 SELECT-only** policy, scoped to own `user_id`.

The conclusion (no browser write path) holds; the reason matters, because if RLS were ever disabled
on one of these the grants would expose writes immediately.

**This audit also found a real design weakness of my own.** `dealer_profiles` carries RLS policies
granting `authenticated` INSERT and UPDATE on their own row, and those policies' `WITH CHECK`
constrains `user_id` but **not `tenant_id`**. The K-round treated a profile's tenant binding as
sufficient by itself, so a self-service write could have bypassed the tenant-type and
membership-role tests. It cannot fire today — CarUp uses custom auth (`auth.users` is empty, so
`auth.uid()` is NULL) and all four profiles have `tenant_id` NULL — but an authority must not depend
on another system's predicate staying incomplete. **`dealer_profiles` is now consulted for
WITHDRAWAL only; it never grants.**

## L5 — `prepare` persists artefacts; it never creates authority

The K wording said `prepare` "creates nothing", which is untrue of the dry run and would have
invited someone to "fix" correct behaviour. Preparation legitimately persists mapping confirmations,
import batches and normalized rows. The invariant is that it creates **no vehicle, evidence, listing
subject or other commerce authority**. Wording corrected in the service and the routes.

`export` is proven actor-owned: `exportVehicleWorkbookFromDatabase` filters
`current_seller_id = actor`, with no tenant branch, so a prepare-only Dealer cannot read another
tenant's inventory.

## dealer_profiles duplicate race — AUDIT ONLY

`dealer_profiles.user_id` has a non-unique index and `createOrUpdateProfile` is read-then-insert, so
concurrent calls could in principle create two rows for one user (4 profiles / 4 distinct users
today). **Direction matters and it is safe:** `maybeSingle()` errors on multiple rows and the
resolver treats an unreadable authority as no authority, so a duplicate **denies** rather than
widening — it can never mask a suspension. Recorded as reliability debt for a separate lane, with a
test pinning the fail-closed direction.

## K5 scope — stated exactly

The workbook router uses `authorizeRole()`, not `authorizeSessionRole()`. What the session suite
proves: a valid session yields the correct actor **through the real workbook router**; invalid,
expired, revoked and unknown sessions fail; the tenant is revalidated per request; and a route that
explicitly opts into the stricter session-only policy refuses an asserted `x-user-id` (with a
positive control). It does **not** prove the workbook router is session-only — production disables
the fallback by deployment policy. Making execute session-only irrespective of environment is a
separate policy change and is not inferred from a test.
