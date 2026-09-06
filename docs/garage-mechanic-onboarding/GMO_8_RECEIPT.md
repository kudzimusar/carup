# GMO-8 — Golden Journey, physical UAT · RECEIPT

**Status: PARTIAL — Acts 1–2 PASS physically at three viewports; Acts 3–6 NOT RUN.**

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

## NOT RUN — and exactly what it needs

Acts 3–6 (governed review → activation → context handoff → mechanic invitation → a real Service
Network job → revocation) were **not executed**. They need two things this run did not set up:

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
