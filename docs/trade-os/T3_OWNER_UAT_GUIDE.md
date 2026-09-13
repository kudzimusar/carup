# Trade OS T3 — Owner UAT guide

- **What this is for:** the single remaining item blocking T3. Everything automation can establish
  is established (see the T3 acceptance ledger in the master plan §25). §29 is explicit that green
  automation never substitutes for owner acceptance, so this is a judgement pass, not a re-test.
- **Programme authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` §10
- **Evidence receipt:** `docs/trade-os/receipts/T3_LOGISTICS_RFQ_IMPLEMENTATION.md`
- **Production:** untouched. PR #207 is Draft.

## Where to look

| | |
|---|---|
| Web | `https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app` |
| Backend it talks to | `carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app` |
| Entry point | `/diaspora/request-quotes` → **Ship something** |

The pairing above was verified at runtime: this frontend calls **only** that backend — never the
shared staging backend, never production. Both are built from the branch.

Synthetic requester and logistics-provider fixtures already exist on staging (marked `SYNTHETIC`,
`@carup-staging.test`). Credentials are deliberately **not** recorded in this repository — ask for
them, or sign up a fresh account: the provider role is reachable from ordinary signup by choosing a
business account with business type **Logistics provider**, which is itself part of what to judge.

## What T3 is claiming to be

T2 answers *"I need to buy something."* T3 answers a **different** question:

> *"I already own or bought this cargo, and I need it moved."*

The whole slice should read as that second product. If at any point it feels like procurement
wearing a different label, that is a finding.

## The judgement pass

Walk it as a customer would, not as a tester. At each step the question is *"would a real diaspora
customer with no freight knowledge understand this, and is every claim on screen true?"*

1. **Ship something** — from Request Quotes. Does the choice between *Ask providers to quote* and
   *Find container space* make immediate sense? (This path previously dead-ended saying multi-provider
   quoting was unavailable; it now leads into the real journey.)
2. **Cargo** — describe household effects, then try a **vehicle**. If the account has CarUp vehicles,
   selecting one should fill in the make/model/year rather than asking you to retype them. Typing it
   manually must remain possible.
3. **Size & weight** — try all three: *Help me calculate it*, *I know the total volume*, and
   *I don't know yet*. Does the CBM explanation land for a non-freight person? Does "I don't know"
   feel genuinely acceptable rather than punished?
4. **Route and review** — check the privacy preview. It claims providers see the cargo and route but
   **not** your identity, contact details or the vehicle's VIN. Judge whether the wording earns trust.
5. **Provider side** — as the logistics provider, open the request. Confirm you cannot tell who asked.
   Build an offer, leaving some charges blank. Unstated charges must read **Not provided**, and the
   total must never be described as "all-in".
6. **Compare and choose** — back as the requester. You *should* see who each offer is from. Is the
   comparison honest about what differs, including unknowns?
7. **Container space** — where the chosen offer references a real sailing, request space. It must be
   clear that this is a **request** and the organiser still has to approve it.
8. **Operator** — approve as organiser and confirm the capacity change reads truthfully.

Also worth a look at phone width: the journey is asserted clean at 393px, but assertions only prove
no overflow — they do not prove it feels right.

## The lines that must not blur

If any screen implies one of these, it is a defect, not a preference:

```text
a logistics quote        is NOT a booking
an accepted quote        is NOT approved capacity
a space request          is NOT an approved booking
booking closed           is NOT shipped
shipped                  is NOT customs cleared
```

Only an **APPROVED** reservation consumes container capacity. That is proven in the data; this pass
is about whether the *screens* say it as plainly.

## What is already proven, so you need not re-test it

Cross-tenant privacy, provider eligibility (a profile, never a role), award atomicity, unknown
measurements staying unknown, the no-reservation-on-award invariant, seven-viewport geometry, and
the full unmocked journey on this exact deployed candidate. Detail and measurements are in the
master plan §30 entries and the receipt.

## Recording the outcome

Append the verdict to the master plan §30 as a new execution entry — pass, or a numbered list of
what to correct. Please separate **defect** (a claim that is untrue, or a journey that breaks) from
**preference** (wording or styling you would choose differently), because they get handled
differently: a defect reopens T3, a preference is scheduled.

T3 stays **T3-PARTIAL** until this pass is recorded.
