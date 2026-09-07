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
