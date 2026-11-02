# CARUP-PAY-05-LR01 — Final certification

**Zimbabwe collections & mobile money (Paynow)** · Programme issue #252 (parent #247) · Moderator framework
`11-11-GM-GC-001` v1.0 · Level 1: full internal implementation, a local Paynow **protocol simulator**, disposable local
databases, no money moves.

The design, the capability matrix and the activation blockers are in
[CARUP_PAY_05_ZIMBABWE_COLLECTIONS_MOBILE_MONEY.md](CARUP_PAY_05_ZIMBABWE_COLLECTIONS_MOBILE_MONEY.md). This document is
the evidence record. Sanitized artefacts are in [evidence/pay05/](evidence/pay05/).

**Specialist recommendation: RECOMMEND ACCEPT** (Level 1 QA acceptance only — not commercial readiness). The specialist cannot
self-accept; the decision is the Moderator's.

## 1. Source custody, exact SHAs, CI

| Item | Value |
|---|---|
| Accepted parent | PAY-04 `18440746db6557bc81ee6644ce7338acbef3378d` (Moderator ACCEPT recorded in #252) |
| Checkpoint A reconciliation | `b3ca4d211f316a40728d56612f4d975c745c4061` (CI and workflow policy only) = PAY-04 **Draft PR #253** (base PAY-03B branch), CI run 41400813645 7/7 |
| Earlier accepted foundations | PAY-03B `c2d548ed` (PR #251), PAY-03A (#250), Garage `69e12e21` (#242): all ancestors, unchanged on origin at every check; none rewritten, merged or replayed |
| Branch | `feat/carup-pay-05-zimbabwe-collections-mobile-money`, built on `b3ca4d21` |
| **Runtime candidate** (physical UAT) | **`a0ddee281e75936da39ea1adb3d8105bead63bc3`** — served from a clean detached worktree at exactly this commit; the backend health route and the web build's provenance both report it |
| Rehearsals before it | Three full physical runs on the same restored data, each of which changed the candidate (§7.1). `git diff --stat ea0511ff..a0ddee28` outside `web/` and `scripts/uat/` is empty: everything after `ea0511ff` is web code, web tests or UAT tooling |
| Final evidence head | the commit that adds this document (reported in the PR and the specialist's return) — commits after `a0ddee28` are documentation, sanitized evidence and the evidence sanitizer (UAT tooling); no runtime, migration or product file |
| Exact-head CI | Run 41451534363 at the candidate `a0ddee28`: **6/6 jobs green** (custody, workflow isolation, backend, PostgreSQL in both orders, web). Earlier runs on this branch: `ab052f3d` 41441902222 6/6; `9b91d439` 41436175937 6/6; `ea0511ff` 41434814958, where the web job failed 1 of 3,675 tests on a timing race inside that test (§7.2, CI note) |
| Merges / rebases / force-pushes | none |
| PAY-05 pull request | Opened as a Draft (base `feat/carup-pay-04-garage-payments`) after the evidence commit, once the workflow-isolation dry run (§2) was clean at the candidate; its number is in the specialist's return. Do not merge |

## 2. Checkpoint A — PR / shared-staging defect: closed

- **Defect:** `diaspora-phases-3-7-validation.yml`'s `staging-integration` job wrote to shared staging for any
  same-repository PR touching the backend (54/54 payments-branch PR runs, 2026-10-29 … 11-02). Eleven other
  PR-triggered workflows held staging secrets.
- **Fix (`b3ca4d21`):**
  - `scripts/ci/workflow-secret-isolation.mjs` encodes four rules (privileged events, PR secrets, shared-data reach,
    shared-data approval) and fails CI on any violation.
  - 20 workflows were remediated.
  - Governed staging integration is dispatch-only, environment-gated, and records an authorization URL and the
    expected SHA.
  - [docs/ci/WORKFLOW_SECRET_ISOLATION.md](../ci/WORKFLOW_SECRET_ISOLATION.md) documents the policy.
- **Verified without touching staging:**
  - The structural dry run on the PAY-04 PR (`evidence/pay05/pay04-pr-dry-run-b3ca4d21.json`, private copy).
  - PR #253's real CI: no staging job ran.
  - The PAY-05 dry run at the candidate `a0ddee28` (`evidence/pay05/workflow-isolation-dry-run-pay05-a0ddee28.json`): 76 workflows,
    **0** violations; 63 jobs in 30 workflows reachable by a pull-request event, **0** with any secret or environment;
    a push to the PAY-05 branch starts 6 jobs and one to the PAY-04 branch 7, **0** with shared-data credentials. The
    same check runs in every exact-head CI run (job 2).
- **Owner-only actions** (repository settings, not code):
  - move the repository-level shared-staging secrets into the `staging` environment with required reviewers;
  - enable "prevent self-review";
  - protect `main`.

## 3. Checkpoint B — provider qualification

Paynow's merchant API is qualified from its own documentation and its official SDK source. The full matrix with
sources is in the design document §3, and the saved copies are hash-pinned (`evidence/pay05/paynow-sources.sha256`).

- **Supported:** hosted initiation; Express EcoCash, OneMoney, InnBucks (USD) and O'mari; one integration per currency;
  USD and ZWG; the integration ID/key hash (both published vectors reproduce); signed status updates; polling; tracing;
  the status vocabulary; settlement to the merchant.
- **Unsupported:** a merchant cancel API; a merchant refund API; aggregator collection; FX conversion.
- **Unverified (fail-closed):** expiry; partial refunds; callback retry interval and IPs; returned-URL hosts; rate limits;
  fees; the test-mode `authemail` rule; the NotFound hash formula.

BillPay's vendor reversal is a different product and proves no merchant refund. `ZIG` is never used as a currency
code; ZWG is a separate integration, never converted.

## 4. Checkpoint C — legal merchant ownership

| Claim | Evidence |
|---|---|
| Garage money is the garage's, never CarUp's | Ledger rows `pay02_funds_owner = garage_business_tenant`, `legal_beneficiary = tenant:<garage>` (SQL smoke C; HTTP P1; HTTP invariant INV) |
| Never CarUp Japan Stripe | Product coverage test; the merchant CHECK refuses a Stripe garage merchant (smoke M) |
| First-party and other-party products blocked, each with a named owner | `pay05ProductCoverage` over all 66 PAY-02 products (test) |
| The garage connects its own merchant; the key is sealed and never returned | Smoke M; services; HTTP M1, M2; browser C-1; HTTP INV key-plaintext scan |
| Independent verification with a server probe and a currency review | Smoke V; services; HTTP M3–M5; browser C-2 |
| Suspension, rejection, disconnection, availability, audit | Smoke O/R; HTTP M5, O1, O2, O3 |

## 5. Checkpoint D — adapter and money (requirement → proof)

| Requirement | Proof |
|---|---|
| Server-authoritative amounts and currencies | The body's currency is ignored (HTTP Z1); the amount comes from the collection; ZWG goes through its own integration (Z1, Z2) |
| Immutable transaction references | One request per collection, recorded before it is sent; guards (smoke C, R) |
| Signed status verification | Hash with the collection's own key; forged, tampered, unsigned and cross-garage updates refused (HTTP S1–S4; services) |
| Provider-read confirmation | A status update only triggers a fresh poll (smoke; services; HTTP P1) |
| Replay and duplicate protection | Event identity; resends (HTTP P2, X3); cross-collection replay (smoke C; HTTP S4) |
| Timeout recovery | Trace recovery, never a second request (HTTP T1–T3, U0/U1; services) |
| Pending, paid, refunded, disputed states | Smoke C/S; HTTP E1–E5, P1, R2, R3 |
| Idempotent reconciliation | Read tickets: stale reads superseded, never applied (smoke R1–R16; services D1) |
| Allocation and receipts | One allocation and one receipt per payment (HTTP P1, P2, X3; INV) |
| F5 holds | `PAY05_F5_NOT_APPLICABLE` (Paynow reports no refund amounts); the PAY-03B/PAY-04 F5 suites regress nothing (§7) |
| Merchant and tenant isolation | Composite foreign keys; one live owner per integration ID; cross-garage refusals (smoke M; HTTP M2, S3, S6) |
| Fail closed where the capability is missing | No cancel, expiry or refund API (design §5.6; HTTP X1, L1–L3, R1) |
| No invented capabilities | The protocol reviewer's check against the saved docs (§8) |

## 6. Checkpoint E — the experience

Headed Chromium at 1440/768/390 against the candidate `a0ddee28`, with web and backend provenance both `a0ddee28` and
the accepted 1,800 s collection time: **12/12 PASS** (`evidence/pay05/browser-journal-a0ddee28.json`; 24 element
screenshots in `evidence/pay05/screens/`). Every surface it screenshots passed three checks: axe WCAG 2.2 A/AA, no
horizontal overflow, and the control check (every visible button holds its words; every radio and checkbox keeps its
size). The tests walk:
- the garage connects its own merchant: field errors sit next to their fields, and the key is never shown again
  (desktop);
- an independent operator verifies with three reviews and a note, and the server proves the key with Paynow (desktop);
- on the hosted page, coming back proves nothing until CarUp reads Paynow (desktop);
- EcoCash shows "approve on your phone" and is never paid until Paynow confirms (tablet);
- InnBucks: the code stays on screen, survives a reload as "continue this payment", and counts only on Paid (mobile);
- O'mari: a wrong code is refused in words, and the right one completes the payment (mobile);
- the garage reads its Paynow payments in its own words, and refunds are guided to the Paynow dashboard (tablet);
- a stopped request stays held: the operator sees CarUp's time and cannot release it early (desktop);
- the checkout, the garage connection and the operator panel at each width.

The PAY-04 surfaces that now also show Paynow money were replayed with PAY-04's own browser spec: 9/9 at the
candidate (§7.2).

## 7. Checkpoint F — security and physical UAT

### 7.1 How the candidate was reached

Every run below used the archived PAY-04 physical-UAT database, restored afresh and upgraded to PAY-05, behind the same
isolated local runtime.

| Run | Result | What it found | Changed in |
|---|---|---|---|
| `64248436` (HTTP), `dd810c28` (browser) | HTTP 35/41; several browser steps failed | Three product defects (below) and several harness expectations | `d1a69691`, `dd810c28`, `ea0511ff` |
| `ea0511ff` | HTTP 41/41, browser 12/12 | Reviewing the screenshots: wrapped money-button labels cut off below 640 px, and method radios squeezed | `ab052f3d` |
| `ab052f3d` | HTTP 41/41, browser 12/12, PAY-04 HTTP 25/26, PAY-04 browser 8/9 | PAY-04's invariant knew one garage-provider gateway; an exception's evidence box on PAY-04's operator page was out of keyboard reach at 390 px | `a37e7f6a` (harness), `a0ddee28` |
| **`a0ddee28`** (candidate) | HTTP 41/41, browser 12/12, PAY-04 HTTP 26/26, PAY-04 browser 9/9; CI 6/6 | — | — |

**`64248436` / `dd810c28`.** The product defects, each fixed test-first:
- E1 (`d1a69691`): an EcoCash request Paynow had not yet reported on read "Waiting for you to pay on Paynow". It now
  says what the customer must do for the method used.
- R2 (`dd810c28`): a PAY-05 refusal raised inside a PAY-04 function reached the operator as "operation unavailable".
  It is now stated.
- The Paynow channel line read "Paid through …" on a row still waiting for Paynow (`ea0511ff`). It now names the
  channel only.

The harness expectations:
- M4 matched the wrong word.
- S5: a malformed id is refused by the generic CSRF check before the route, which reveals nothing about existence.
- L1 and L3 ran after the expiry window had already passed. The early-release refusal now runs first (L0: 409
  `PAY05_HOLD_NOT_RELEASABLE`).
- Browser steps used locators that matched more than one invoice or row, expected the wrong panel for continuing a
  payment, or depended on an earlier test's state.

**`ea0511ff`.** Every check passed, but its 24 screenshots showed two layout defects the checks did not measure:
- Below 640 px, a money button whose label wraps kept the shared Button's 44 px phone height, so the label was cut off.
  "Pay 20.00 USD with Card, Zimswitch or another method on Paynow’s page" needed 52 px at 390 px, and the operator's
  "Check with Paynow and release the hold" touched both edges. PAY-04's provider button has the same classes
  (inherited from `b3f1b3be`).
- Each payment method's radio shrank when the words beside it wrapped: 13×20 px at 390 px, InnBucks 15×20 px at 768 px.

The browser spec now measures every visible control on each surface it screenshots: a button's content must fit its
box, and radios and checkboxes must stay square. Run against the `ea0511ff` runtime, that check failed at 390 px and
768 px with exactly those measurements (`rehearsal-clipping-check-red-ea0511ff-*.txt`,
`screens/rehearsal-ea0511ff-*.png`). `ab052f3d` fixes both (`max-sm:h-auto`, `shrink-0`), with unit tests that pin the
cause. It also fixes two smaller things:
- The operator panel read the clock during render, so an open panel never enabled a release when CarUp's payment time
  passed. It now keeps its own clock (a fake-timer test, watched failing first).
- PAY-05's files had 7 lint errors that the PAY-04 head did not; they now have none.

**`ab052f3d`.** The PAY-05 runs passed again (HTTP 41/41, browser 12/12, the control check included). The PAY-04
regression found two things:
- **PAY-04 HTTP 25/26.** Its invariant case counted 18 ledger rows as "garage money as CarUp money". All 18 were PAY-05
  Paynow rows owned by their own garage, with that garage as beneficiary. The accepted query treated every gateway other
  than the PAY-04 simulator as CarUp money, which held only while the simulator was the sole garage-provider gateway.
  `a37e7f6a` lists both garage-provider gateways and keeps the funds-owner condition. Measured on that database, the
  new form counts 0. Narrowed back to the simulator it counts 18, and with an owner nobody has it counts 40 of 40, so
  both conditions still catch violations. The case now reports the rows per gateway. The PAY-04 harness is otherwise
  byte-identical to the accepted head `18440746`.
- **PAY-04 browser 8/9.** At 390 px axe refused PAY-04's operator page (`scrollable-region-focusable`). The evidence of
  a PAY-05 "Paynow took money after CarUp had closed this payment" exception overflowed its capped box, which a
  keyboard could not reach (WCAG 2.1.1). The box is PAY-04's (`4546e00a`); PAY-05's exceptions are the first whose
  evidence overflows it on a phone. `a0ddee28` makes it a named region in the tab order, the pattern this codebase
  already uses, with a test watched failing first.

Then everything was run again at `a0ddee28` on a freshly restored database.

### 7.2 Results at the candidate

| Evidence | Result |
|---|---|
| PostgreSQL certification, payments-first and garage-first: upgrade fingerprint unchanged, then behaviour (certified PAY and PAY-04 smokes on the PAY-05 functions, then the PAY-05 smoke) | PASS in both orders at the candidate (`PAY05_POSTGRES_CERTIFICATION_PASS` payments-first and garage-first, CI run 41451534363) |
| Upgrade over the archived PAY-04 **physical-UAT** database (16 invoices, 14 collections, 79 ledger entries) | Applied; PAY-04 money fingerprint identical before and after (`1eb4a35f…`) — `evidence/pay05/upgrade-with-real-rows.json`. Repeated before each run above: the archive's checksum verified, ledger 79 → 81 |
| Real-PostgreSQL services over real HTTP to the simulator (a skip is a failure) | PAY-05 14/14 and PAY-04 22/22 in both orders; PAY-03B 29/29 on the payments-first database (CI run 41451534363) |
| Backend regression job (PAY-05 contracts, PAY-04 static contracts, Garage domains, inherited gates, PAY-03B/01/02/03A) | PAY-05 contracts 111/111; PAY-04 static contracts 18/18 (its 20 database cases run in the PostgreSQL jobs); Garage domains 120/120; inherited gates 784/784; PAY-03B/01/02/03A 131/131; workflow-isolation policy 23/23 (CI run 41451534363) |
| Web | 3,681/3,681 tests, `tsc -b` clean, production build (CI run 41451534363). No lint error in PAY-05's files that the PAY-04 head did not have |
| Mutation | 58/58 mutants killed at `ea0511ff` (SQL, services, protocol, routes and web), 4/4 unmutated baselines green; the non-web code has not changed since. The web mutants were run again at `a0ddee28` with six new ones for the later fixes: 11/11 killed, baseline green (`evidence/pay05/mutation-report-*.json`) |
| Physical HTTP matrix (PAY-05), authenticated | **41/41 PASS** against the candidate `a0ddee28` (backend and harness; collection time 300 s so that expiry is reachable), recorded 2026-11-02T13:47:16Z — `evidence/pay05/http-matrix-a0ddee28.json`. The invariant case read real rows: 0 key-plaintext hits for 5 keys across 11 tables (4 integrations, 13 Paynow requests, 27 observations, 10 provider errors, 188 collection events, 221 domain events); 13/13 Paynow ledger rows are garage money; 6/6 issued receipts equal the counted money; 0 of 17 invoices over-allocated; at most one Paynow request per collection (13 collections); no `ZIG` (`http-matrix-a0ddee28-denominators.json`). The same 41/41, with the same counts, at `ea0511ff` and `ab052f3d` |
| PAY-04 26-case HTTP regression | **26/26 PASS** at the candidate `a0ddee28` (backend and harness; the accepted 1,800 s collection time), recorded 2026-11-02T14:14:10Z — `evidence/pay05/pay04-regression-http-matrix-a0ddee28.json`. Its invariant case reports the garage-collection ledger rows per gateway (PAY-04 simulator 24, Paynow 18) and none as CarUp money. The PAY-04 harness differs from the accepted head only in that invariant (§7.1, `ab052f3d`) |
| PAY-04 browser replay | **9/9 PASS** at the candidate `a0ddee28` (headed; web and backend provenance `a0ddee28`; axe WCAG 2 A/AA at three widths) — `evidence/pay05/pay04-regression-browser-journal-a0ddee28.json`. The PAY-04 spec is byte-identical to the accepted head. At `ab052f3d` it was 8/9 (§7.1) |
| PAY-05 browser, headed Chromium at 1440/768/390, axe WCAG 2.2 A/AA, every visible control measured | **12/12 PASS** at the candidate `a0ddee28` (headed; web and backend provenance `a0ddee28`; the control check on 9 surfaces) — `evidence/pay05/browser-journal-a0ddee28.json`. Also 12/12 at `ab052f3d`, and 12/12 at `ea0511ff` before the control check existed (§7.1) |

**CI note.** At `ea0511ff` the web job failed one of 3,675 tests (W5). The test read the checkout's live region in the
same tick as the badge, but the region takes its words one effect later by design (W8: it is in the page, empty,
before it speaks). The test now waits for the region (`9b91d439`, test-only). With the review wording removed from the
status line, both W5 tests still fail; restored, the file passed 8/8 consecutive local runs.

## 8. Independent review and mutation

Four fresh read-only reviewers were given the code and the directive, not the author's conclusions:
- DB money model (D);
- backend security (S);
- Paynow protocol fidelity against the saved docs (P);
- web truth and accessibility (W).

They found no Critical, five High and about fifteen Medium. Every finding is fixed test-first or documented as a
Level 2 item; the register with each disposition is `evidence/pay05/independent-review-37cb5c5c.md`. The High
findings:
- D1: a stale read could move money (now: read tickets; older reads superseded).
- P1 / D2 / S2: a late signed Paid was lost (now: late attach + a provider-paid-after-close review).
- W1: the express panel unmounted after Pay.
- W2: an existing payment could not be continued.

A first mutation campaign (56 mutants at `4fe9a796`) left four mutants alive. The tests that pin them were added
(`64248436`), and the final campaign killed 58/58 at `ea0511ff`. The web mutants, with six new ones for the later
fixes, killed 11/11 at the candidate `a0ddee28` (§7.2).

These reviewers do not replace a Moderator-appointed independent certifier (`NOT_ASSIGNED`).

## 9. Checkpoint G — real provider rehearsal

**BLOCKED_OWNER_PROVIDER_EVIDENCE.** No Owner + Paynow authorization exists, so no real merchant, credential or Paynow
call was used. Real Paynow stays off by construction: the database refuses a real-mode integration until a reviewed
activation migration, and the backend refuses it without `CARUP_PAY05_REAL_PROVIDER_AUTHORIZED`. The design document
§8 lists exactly what unblocks it, including the 19 questions only Paynow can answer.

## 10. Blockers

| # | Blocker | Resolver |
|---|---|---|
| B1 | Real Paynow activation (Checkpoint G): a garage's real merchant, its credentials, Owner + Paynow authorization | Owner + Paynow + the garage |
| B2 | Paynow-only answers (design §8: 19 questions, each fail-closed today) | Paynow, through the Owner |
| B3 | Repository settings: environment-scoped staging secrets, prevent self-review, protect `main` | Owner |
| B4 | Other programmes' workflows are red on PR #253 (Corporate/auth, Phase C, full-backend baselines) and will be on the PAY-05 PR; none is a PAY-05 check | Their owners |
| B5 | Independent certifier `NOT_ASSIGNED` | Moderator |

**Residual observations (not PAY-05 defects, not blockers).**
- PAY-03B's `web/src/pages/dashboard/dealer/Subscription.tsx` gives three outline buttons `h-auto` under the shared
  Button's `max-sm:h-11`: the same pattern that cut off PAY-05's labels at 390 px (§7). PAY-05 does not change that
  file, and this run did not measure its labels. Owner: PAY-03B.
- The shared Button (`web/src/components/ui/button.tsx`) could accept wrapping labels directly. PAY-05 fixes its own
  call sites instead of changing a component the whole app uses. Owner: design system.

## 11. GM-GC-001 continuity record

| Field | Value |
|---|---|
| Task identifier | CARUP-PAY-05-LR01 (programme issue #252, parent #247) |
| Accepted baseline | PAY-04 `18440746` (Moderator ACCEPT) + its CI-only reconciliation `b3ca4d21` (PR #253) |
| Active source owner | PAY-05 implementation specialist (this assignment) — the single writer |
| Independent certifier | `NOT_ASSIGNED` (Moderator to appoint) |
| Parent / candidate SHAs | parents `18440746`, `b3ca4d21` (unchanged on origin); runtime candidate `a0ddee28`; rehearsals `64248436`/`dd810c28`, `ea0511ff`, `ab052f3d`; final evidence head the commit that adds this document (reported in the PR and the specialist's return) |
| Current gate | Checkpoints A–F and H complete at Level 1; G `BLOCKED_OWNER_PROVIDER_EVIDENCE` → **awaiting Moderator** |
| Evidence types | *Test:* SQL smokes in both orders, real-PostgreSQL services, unit and UI suites, mutation. *Physical:* authenticated HTTP matrix and headed Chromium at three widths on an isolated local stack upgraded from the archived PAY-04 UAT data; the PAY-04 matrix and browser replay against the candidate. *CI:* exact-head (§1). *Provider:* the local protocol simulator only — no external provider evidence (Level 2 not authorized) |
| Blockers | B1–B5 (§10), each with its resolver |
| Continuation record | this document, the design document, the independent-review register and the private `~/carup-launch-evidence/pay05/HANDOFF.md` |
| Next action | Moderator: accept or remediate PAY-05 at the final head and appoint a certifier. Owner: B1–B3. After acceptance: PAY-06, the next dependency-safe package, on this line without rewriting it |

**Agent register (this assignment).**

| Agent | Role | Access | Output and disposition |
|---|---|---|---|
| PAY-05 specialist (lead) | Single source writer: database, backend, UAT harness, integration, evidence | The PAY-05 worktree; disposable local stacks only | Every commit on the branch |
| Paynow capability researcher | Checkpoint B: Paynow's documentation and official SDK source | Read-only, public web | The capability research and saved sources (hash-pinned) → design §3 |
| Reviewer D — DB money model | Independent review | Read-only | Register D1–D9 → fixed or documented |
| Reviewer S — backend security | Independent review | Read-only | Register S1–S10 → fixed |
| Reviewer P — protocol fidelity | Independent review against the saved Paynow docs | Read-only | Register P1–P8 → fixed or documented (Level 2) |
| Reviewer W — web truth and accessibility | Independent review | Read-only | Register W1–W12 → fixed |
| Web remediation implementer | Wrote the W-finding fixes test-first in a separate worktree | Its own worktree; no push | Reviewed and cherry-picked by the lead (`9769ad09` … `65303aca`) |

**Measurable baseline — this single approved work package.**

| Measure | Numerator / denominator |
|---|---|
| Checkpoints complete at Level 1 | 7 / 8 (A, B, C, D, E, F, H); G blocked on Owner + provider evidence, not failed |
| PAY-02 products classified for PAY-05 | 66 / 66 (garage collections in scope; first-party and other-party products blocked with named owners) |
| Independent-review findings dispositioned | all / all (no Critical; every High and Medium fixed test-first; Level 2 items documented) |
| Mutants killed | 58 / 58 at `ea0511ff` (non-web code unchanged since); web 11 / 11 at the candidate `a0ddee28` |
| PAY-05 HTTP matrix | 41 / 41 at the candidate (and at `ea0511ff` and `ab052f3d`) |
| PAY-05 browser tests | 12 / 12 at the candidate (and at `ea0511ff` and `ab052f3d`) |
| PAY-04 HTTP regression | 26 / 26 at the candidate (25 / 26 at `ab052f3d`, before the harness correction) |
| PAY-04 browser replay | 9 / 9 at the candidate (8 / 9 at `ab052f3d`, fixed in `a0ddee28`) |
| Real-provider rehearsals | 0 / 0 authorized |

The CarUp Payments **portfolio** percentage remains `NOT_BASELINED` until the Owner approves the programme package
denominator.

## 12. Recommendation

**RECOMMEND ACCEPT** — Level 1 QA acceptance of PAY-05 at the runtime candidate `a0ddee28`. This is not commercial
readiness: real Paynow stays off by construction, and Checkpoint G is `BLOCKED_OWNER_PROVIDER_EVIDENCE` (§9).

- **Merchant ownership holds in data.**
  - Garage money goes only through the garage's own verified Paynow merchant.
  - It lands on the canonical ledger as the garage's money: 13/13 Paynow ledger rows at the candidate, and 18/18 across
    PAY-04's own view.
  - CarUp first-party and other-party products stay blocked, each with a named owner. Nothing routes through CarUp
    Japan Stripe.
- **Paynow is integrated as documented, and no further.**
  - Hosted checkout and Express EcoCash, OneMoney, InnBucks and O'mari; USD and ZWG through separate integrations
    (never `ZIG`, never converted).
  - Signed updates only trigger an ordered read (read tickets), and only that read can move money.
  - Timeouts recover by trace, never by a second request. Late money is caught for review, not lost.
  - No cancel, refund or expiry API is invented: each fails closed with an operator path.
- **Evidence at the exact candidate.**
  - CI 6/6 (run 41451534363): PostgreSQL certification in both orders; real-PostgreSQL PAY-05 14/14, PAY-04 22/22 and
    PAY-03B 29/29; backend 111 + 18 + 120 + 784 + 131; web 3,681/3,681.
  - Physical runs on the archived PAY-04 data: PAY-05 HTTP 41/41 and headed browser 12/12 at three widths, with axe
    and the control check. PAY-04's own 26-case matrix 26/26 and browser replay 9/9.
  - Mutation 58/58 at `ea0511ff`, whose non-web code the candidate shares, and web 11/11 at the candidate.
- **Review.** Four independent read-only reviews found no Critical; every High and Medium is fixed test-first or
  documented as Level 2 (§8).
- **Rehearsals.** Three full rehearsals each changed the candidate, and each finding is fixed and now measured
  (§7.1):
  - three product defects;
  - two layout defects seen only in screenshots;
  - a PAY-04 invariant that knew one gateway;
  - a keyboard-unreachable evidence box on PAY-04's operator page.

  No High or Medium defect is known open in PAY-05.

Open, and not PAY-05 defects: B1–B5 (§10) and the residual observations for PAY-03B and the design system. The
Moderator's acceptance would let PAY-06 start on this line without rewriting it.
