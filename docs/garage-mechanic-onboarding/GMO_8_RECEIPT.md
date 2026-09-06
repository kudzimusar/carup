# GMO-8 — Golden Journey, physical UAT · RECEIPT

**Status: PARTIAL — Acts 1–2 PASS physically at three viewports; Acts 3–6 NOT RUN.**

## The candidate

```
frontend  carup-staging-git-feat-garage-mechanic-onboarding-1-0-11-11.vercel.app
backend   carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app
commit    0d78379fe1688d6f821856af1dca400311d42e06   (both sides)
unpaired  false
```

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
