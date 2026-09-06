# GMO-8 — Golden Journey, physical UAT · RECEIPT

**Status: PARTIAL.** Acts 1–2 PASS physically at three viewports (27/27). Acts 3–6 were subsequently run: **10 PASS, 1 BLOCKED, 12 blocked upstream** — see the second half of this receipt. The block is a paid vision provider, and §"There is no human fallback" below explains why no reviewer can work around it.

## The candidate

```
frontend  carup-staging-git-feat-garage-mechanic-onboarding-1-0-11-11.vercel.app
backend   carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app
commit    92ddaf94   (both sides)          ← the certified head
unpaired  false
```

First run was at `0d78379f`. The suite was **re-run in full at `92ddaf94`** — the head that ships —
because the commits between them touched four product files, and "those changes look equivalent" is
an argument, not a measurement. Both runs: 27/27.

The harness **refuses to run** if `unpaired !== false` or the two SHAs differ. That guard exists
because a preview frontend once silently borrowed the shared staging backend, so a UAT measured
`main`'s contract while appearing to certify a PR.

The backend alias was read from `vercel inspect` — never constructed. It carries a hash
(`…onb-803043…`) that cannot be derived from the branch name.

## Result — 27 / 27, no failures, no 5xx

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

Two console errors per run, both transient cold-start `Failed to fetch` on unrelated dashboard
widgets (`/notifications/me`, `/marketplace/*`). CORS between the paired previews was verified
directly: the backend returns `access-control-allow-origin` for the paired frontend on both
preflight and simple requests.

## What the deployed product actually proved

- **The dead end is gone.** Registering as `Business → Garage / service centre` now leads to a
  surface that is theirs. Verified at the wire: the registration POST carries
  `account_kind:"business", business_type:"garage"`.
- **PO-2 survives deployment.** The live evidence menu offers **9 kinds**, leading with *"Photo of
  your workshop"*. Company registration is present and not required.
- **Submitting grants nothing**, in the applicant's own words, on the deployed page.
- **The gate names what is missing before the button is usable** — not a 400 afterwards.
- **A pending applicant has no garage context and cannot open Operations.** Both checks first prove
  a real session exists, because an anonymous visitor is refused everywhere and would pass a naive
  version of this test while proving nothing.

The backend preview additionally answers **401, not 404**, on all five GMO route families — deployed
proof they are mounted and gated — with every OCR provider `false`.

## What Acts 1–2 did NOT cover — and exactly what it needed

Acts 3–6 (governed review → activation → context handoff → mechanic invitation → a real Service
Network job → revocation) were **not part of this first run**. They needed two things it did not set
up — both were resolved before the Acts 3–6 run recorded below:

1. **A CarUp Operations reviewer.** There is no self-service path to becoming one, correctly. It
   requires registering an account through the product and then setting its `users.role`
   out-of-band — legitimate, because CarUp's own staff are provisioned by CarUp, but it must be
   recorded as PROVISIONED rather than passed off as product behaviour.
2. **Governed O2 identity approval for the applicant.** PO-2 makes it a prerequisite for approval,
   and it is O2's decision, which this programme consumes rather than owns.

The harness has a `PROVISIONED` result status reserved for exactly these, so they can never be
counted as passes.

**Everything that constitutes onboarding authority remains in-product.** No SQL in the harness
creates a tenant or a `tenant_users` row, and the enumerated invariant in
`service-network-authority-boundaries` proves only two code paths can.

## Four measurement errors I made, and what each cost

This run took six attempts. Every failure was mine, not the product's, and each is the same shape:
**a check that could not see what it claimed to see.**

1. **A swallowed click.** `.click().catch(fallback)` masked a failed selection, producing an
   `account_kind: individual` account. Every downstream step then measured the wrong journey while
   looking plausible. Removed the fallback.
2. **Positional selectors.** Choosing "Zimbabwe-based / local" reveals a Province field and shifts
   every input index, so `nth(2)` filled the wrong box. Replaced with placeholder selectors, which
   describe what a field *is*.
3. **Copy-guessing in an assertion.** Step 3 tested for *"not a garage applicant"*; the refusal
   state actually says *"Garage setup is not open on this account"*. The check read a refusal as a
   pass. Now asserts on `data-testid`.
4. **A signature mismatch.** `register(page, who, { business })` was called with `{ name, type }`,
   so `business` was `null`, the entire business branch was skipped, and the guard meant to catch
   exactly this lived *inside* that branch. Fixed, and the "no register POST observed" check was
   hoisted out so a signature mistake cannot silently skip its own guard again.

Errors 1 and 4 are the GMO-5 lesson repeating: **a guard placed inside the branch it is meant to
protect cannot fire when that branch is skipped.**

## Re-running

```
node scripts/uat/gmo-8-golden-journey.mjs --viewport=desktop|tablet|mobile
```

Fails closed on unpaired or mismatched SHAs. Artifacts and a `report.json` land in `/tmp/gmo8-*`.


---

# Acts 3–6 — governed review, activation, context, invitation, revocation

**Status: 10 PASS · 1 BLOCKED · 12 blocked upstream.** Run at `37c96874`, paired, both sides one SHA.

`scripts/uat/gmo-8-acts-3-to-6.mjs`. Each step records HOW it was driven — `[browser]` a person
clicking the product, `[api]` a real governed endpoint with a real session and real step-up, `[db]` a
readback only.

## What is proven

| # | how | step |
|---|---|---|
| 2 | browser | an unprovisioned person registers as a Garage |
| 3 | api | they hold a real session |
| 4 | browser | they fill in the application — **confirmed on the server**, not just on screen |
| 5 | api | the application exists and names no tenant |
| 6 | api | business-presence evidence attaches — a signage photo, no company papers |
| 7 | browser | they send it; status becomes `submitted` |
| 8 | api | the reviewer signs in and **steps up** |
| 9 | api | the application appears in the reviewer's queue |
| 10 | api | **approval is REFUSED while identity is unapproved — PO-2 enforced, not assumed** |
| 11 | api | the applicant submits identity verification through the governed endpoints |

Step 10 is the one worth pausing on. PO-2 says governed person-identity approval is a prerequisite
for a garage workspace. That is not a claim in a document here — the deployed product refuses the
approval, by name, and says why.

## BLOCKED — and it is a stop condition, not a defect

Step 12, the governed identity approval, cannot succeed on this deployment:

```
documentClassifier.js:121   if (!apiKey && !mockAllowed) return { classification: UNCERTAIN,
                                            reason: 'Classification provider unavailable.' }
verificationSessionService  UNCERTAIN → primary_reason_code = 'DOCUMENT_NOT_VISIBLE'
reasonCodes.js              DOCUMENT_NOT_VISIBLE.approveAllowed = false
decisionPolicy.js:92        'Approval is not permitted when the primary reason is "…"'
```

Every document-quality reason code has `approveAllowed: false`. The deterministic Layer-1 classifier
is a **rejection-only** path — it can fail an image for blur, size or duplication, but it can never
produce a passing classification. The only non-provider success path requires `NODE_ENV=test` with
`ALLOW_OCR_MOCK`, which must never be set on a production-shaped deployment (a staging
`NODE_ENV=test` once opened a credential-free admin bypass).

**So governed identity approval has a hard dependency on a paid vision/OCR provider**, and PO-2 makes
it a prerequisite for garage approval. Closing Acts 4b–6 therefore requires activating one — which
the directive names as a stop condition. **I did not activate it.**

This is not a defect in GMO, and not a defect in O2. It is a real dependency that was invisible until
someone walked the whole journey.

### There is no human fallback — and that is worth the owner's attention

I looked for a legitimate manual path before accepting the block, because "a reviewer looks at the
document themselves" is exactly what should happen when automation is unavailable. There isn't one:

```js
decisionPolicy.buildAssessmentSummary()
  const primaryReasonCode = session.primary_reason_code || classificationResult?.reasonCode || null;
```

The policy input is the reason code **stored on the session row**. A reviewer's own `reason_code` is
recorded on their decision but never reaches this check, so it cannot clear a blocking one. With no
classifier the row is permanently `DOCUMENT_NOT_VISIBLE`, `approveAllowed:false`, and **no reviewer
can approve any identity, ever** — regardless of what they can see with their own eyes.

That is a design observation about O2, not a GMO defect, and closing it would be a new authority
decision rather than something this lane should quietly add. But the consequence is worth stating:
**a vision-provider outage is a total identity-verification outage**, with no manual degradation
path. Every downstream journey that PO-2 gates on identity — this one included — stops with it.

### And the ledger refuses it a second time, on purpose

Reading the decision policy told me a reviewer's own reason code never reaches the approve check. I
then went one layer further, to the thing a reviewer would have to reach even if it did — the
identity lifecycle ledger, which is what `usable_for_identity_gated_actions` is actually derived
from. It refuses independently, and in so many words:

```js
identityLifecycleService.js
  const APPROVAL_ONLY_STATES = new Set([LIFECYCLE_STATES.VERIFIED, LIFECYCLE_STATES.RECOVERED]);
  //  "States only the identity domain itself may enter, via the governed approval hook —
  //   a human transition endpoint cannot mint them, and the SUBJECT can never reach them at all."

  transitionIdentityLifecycle(...)
    if (APPROVAL_ONLY_STATES.has(nextState))
      throw new ForbiddenError(`'${nextState}' is minted only by a governed verification approval
                                — it cannot be set directly.`)
```

The only writer of a capability-bearing state is `onVerificationApproved`, reached from
`decisionRecorder` **after** the decision policy has allowed APPROVE. So the two refusals are the
same law stated twice: *no human hand-verifies an identity without evidence.*

That changes what this block IS. It is not a missing key that happens to leave a gap — it is a
deliberate, defended platform law, and a vision provider is the only thing the platform accepts as
the evidence that satisfies it. **This also settles what I must not do:** I considered writing the
approved lifecycle state directly on staging so that Acts 4b–6 could at least be measured, and
rejected it. Minting `verified` by SQL is precisely the act these two guards exist to prevent, it
would sit in a shared ledger indefinitely, and a journey certified on top of it would be certifying
the one thing the platform says is impossible. Acts 4b–6 stay unmeasured.

### What would close it

Set a vision-provider key on the staging backend preview and re-run
`node scripts/uat/gmo-8-acts-3-to-6.mjs --reviewer=<email>`. Steps 13–24 are written and waiting:
approval → activation → idempotent retry → founder context → workshop entry → invitation → mechanic
registration and acceptance → spent-invitation refusal → revocation → last-administrator refusal.

## Three quality gates the product applied, correctly, to my synthetic evidence

Worth recording because each one refused a shortcut:

1. **`DOCUMENT_TOO_SMALL`** — a 1×1 pixel. Correct.
2. **`FRONT_BACK_DUPLICATE`** — the same image for front, back and selfie. Correct.
3. **`DOCUMENT_NOT_VISIBLE`** — a generated PNG is not an identity document, and with no classifier
   available nothing can say otherwise. Also correct.

A fixture that had slipped past these would have certified a path no real document takes.

## What Acts 3–6 found in my own code

**Autosave kept only the last field a person typed.** Proven on the deployed product by its own
network log — three fields filled, one saved:

```
[patch requests] 2 · POST {} | PATCH {"attestation_accepted":true}
```

`queueSave` replaced the pending patch along with the timer. It hid because `send()` flushes
everything, so submitting was always correct; the bug only bit someone who filled the form and left
before finishing — while "Saved at 11:40 PM" sat on screen telling them it was fine. Fixed, with two
mutation-proven tests, and re-verified on the deployed build:

```
[patch requests] 3 · POST {} | PATCH {"trading_name":…,"address_line":…} | PATCH {"service_categories":…}
```

## Four harness errors of mine, recorded

1. **No CSRF token.** Every mutation returned a 403 that looked exactly like an authorization
   refusal — and **two steps reported PASS on it**, "the invitation is spent" and "the last
   administrator cannot be removed", neither of which had reached the logic it claimed to test. Both
   now require the *specific* refusal, not any 403.
2. **Wrong upload payload key** (`image_base64` for `image`) with unchecked responses, so three
   uploads failed silently and only `submit` complained.
3. **Category toggles awaited as checkboxes** — they are `aria-pressed` buttons, so `.check()`
   waited on an element that does not exist.
4. **A test that set each field to the value it already held**, so React fired no change and the
   test drove a form it never altered.

All four are one shape, and it is the shape this programme keeps producing: **a check that could not
see what it claimed to see.**
