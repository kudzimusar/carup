# CARUP-PAY-04-LR01 — Final certification

**Garage invoices, parts and workshop service payments** · Programme issue #247 · Moderator framework
`11-11-GM-GC-001` v1.0 · Level 1 (full internal implementation; local provider simulator; no money moves).

The design, contracts and how-to-run live in [CARUP_PAY_04_GARAGE_PAYMENTS.md](CARUP_PAY_04_GARAGE_PAYMENTS.md). This
document is the evidence record. Sanitized artefacts are in [evidence/pay04/](evidence/pay04/README.md).

**Specialist recommendation: RECOMMEND ACCEPT** (Level 1 QA acceptance only — not commercial readiness; see §15). The
specialist cannot self-accept; the decision is the Moderator's.

## 1. Source custody, exact SHAs and CI

| Item | Value |
|---|---|
| Authorized Payments parent | `c2d548edbe4cc7ac9528f3c4a2c7f55a1d8bad88` (PAY-03B, PR #251 Draft; PAY-03A PR #250 Draft) — unchanged on origin at every check |
| Accepted Garage parent | `69e12e21941a318c1ad6a3266cc8144de44c5d32` (Garage Final, PR #242 Draft; OPS03 PR #241 `07b60e5d`) — unchanged on origin at every check |
| Integration merge | `3ab0d7eb` (parents `c2d548ed`, `69e12e21`); post-merge fixes `0ee715ae` |
| Branch | `feat/carup-pay-04-garage-payments` (pushed; **no pull request** — see below) |
| Runtime candidate (physical UAT) | `d421965ec3ffaea19a45a6a53fe4601fe89313fc` — served from a clean detached worktree at exactly this commit; the backend health and the web build's provenance both report it |
| Later commits | the browser spec's screenshot styling (`2d2f88f3`, `fdd61726`: the app's sticky header and bottom navigation hidden during capture only), then documentation and sanitized evidence. No file under `backend/`, `database/`, `web/src` or `shared/` changes after `d421965e` |
| Merges / force-pushes / rebases | none |

**Why there is no pull request.** A same-repository PR whose diff carries this integrated line (1,201 files against the
PAY-03B branch, because it includes the Garage integration) would also fire `diaspora-phases-3-7-validation`, whose
`staging-integration` job inserts and then deletes rows on **shared staging** with a repository-level secret. That job
ran on PR #251's own head (`c2d548ed`, run 41366583419, four live scenarios). PAY-04 has no shared-staging authority
("Shared staging mutation: NONE"), so exact-head CI runs from a **branch-scoped push trigger** on PAY-04's own workflow
(`b3d01e5b`); a push fires no other workflow (verified against every workflow's triggers). Opening the PR is an Owner
decision (§15, B7).

**Exact-head CI (`pay04-garage-payments-ci.yml`, push-triggered; checkout = the pushed commit):**

| Head | Run | Custody | Backend | PG payments-first | PG garage-first | Garage races (PG16) | Web |
|---|---|---|---|---|---|---|---|
| `b3d01e5b` | 41381469909 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `da6037df` (runtime candidate) | 41386695261 | ✅ | ✅ | ❌ one flaky pre-existing test (forgery left the signature unchanged; 1 in 16) | ✅ | ✅ | ✅ |
| `c8e45625` (the flake fixed, test-only) | 41387330172 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `d421965e` (runtime candidate after the browser-UAT fixes) | 41390145375 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| final evidence head | reported in the specialist's return — a commit cannot contain its own CI result | | | | | | |

## 2. Integration map

See the design document §3 for the full record. In short: the two accepted lineages had never met; one merge commit
(`3ab0d7eb`) with both accepted heads as parents keeps every Garage commit's identity and attribution, and CI re-proves
custody on every run (both parents are ancestors; no migration either parent shipped is rewritten; PAY-04 migrations
sort after both tips). Hazards handled: out-of-order T11-CAP migrations (both orders certified), single-lineage
`garage-final-ci` (PAY-04 carries two-parent custody), the shared `communication_domain_event_dedupe_key()` (PAY-04
uses its own trigger), and the four re-created PAY-03B F5 functions (a drift test pins them to F5).

**Single authoritative writer per record:** OPS07 writes invoices, lines, declared payments and their receipts
(unchanged); PAY-04's SECURITY DEFINER writers write collections, allocations, provider receipts, events and
discrepancies; the canonical ledger row is `payment_transactions`, moved only through F5's transition function.

## 3. Changed files and migrations

PAY-04 delta `0ee715ae..` final head: 103 files — 3 migrations, 34 sanitized evidence files, 66 code, test, harness,
CI and documentation files. The migrations are additive (`-- +migrate Up/Down`; the provider migration's Down refuses
with `PAY04_RETAIN_PAYMENT_EVIDENCE`):

| Migration | Content |
|---|---|
| `20261102100000_carup_pay04_garage_invoice_integrity.sql` | invoice-line provenance guard; billed-usage reversal guard; garage payment instructions |
| `20261102110000_carup_pay04_garage_provider_payments.sql` | runtime guard, merchant accounts, collections, allocations ledger, provider receipts, events, provider event receipts, discrepancies, money function, OPS07 balance re-created (same signature), F5 extensions, governed writers |
| `20261102120000_carup_pay04_garage_payment_notifications.sql` | once-only identity for `garage.payment.confirmed` / `.refunded` (own trigger) |

Other areas: backend services, routes, `server.js`, security middleware, backend tests and SQL smokes, web surfaces and
their tests, the browser spec, the shared navigation manifest, the CI workflow and certification script, the UAT
harness and these documents (`git diff --stat 0ee715ae..` lists them).

## 4. Invoice, payment and receipt contracts

- **Invoice** (OPS07): a commercial obligation, not payment evidence. Adjustment = void + re-issue.
- **Declared payment** (OPS07, `source = 'garage_recorded_external'` only): money the garage says it received outside
  CarUp; receipt labelled "Recorded by the garage. CarUp has not processed or verified this payment."
- **Provider payment** (PAY-04 collection → canonical `payment_transactions` row, product `gar.invoice.customer_payment`,
  `category_b_third_party`, funds owner `garage_business_tenant`, beneficiary `tenant:<garage>`): counts only when the
  provider confirms it (a fresh provider read), through the append-only allocation ledger; its receipt (shared `RCT-`
  numbering) is labelled "Confirmed by the garage's payment provider. The money is paid to the garage, not to CarUp."
- **Money view** `pay04_invoice_money`: total, declared, provider-confirmed, paid, balance, reserved, uncommitted; the
  OPS07 balance (same signature) = declared net + provider allocated net.
- **States people read** (never "paid" or "nothing was charged" before the provider says so): awaiting provider ·
  stopping · expired · stopped · cancelled · confirmed · confirmed (not counted) · under review · refund pending ·
  partly refunded · refunded.

## 5. Product coverage matrix

The design document §8 has the full matrix (owner, beneficiary, payer, currencies, tariff, provider authority, refund
rules, fulfilment, status, blocker → resolver), derived from the PAY-02 catalogue by code and tested. Status:

| Product | PAY-04 status |
|---|---|
| `gar.invoice.customer_payment` | **IMPLEMENTED_LEVEL1** (Mode 1 live-capable; Mode 2 simulated) |
| `gar.work_order.diagnostic_fee` | **IMPLEMENTED_AS_INVOICE_LINE** |
| `gar.parts.retail_sale` | **WORKSHOP_CONSUMPTION_IMPLEMENTED_RETAIL_SALE_DEPENDENCY** |
| `gar.appointment.booking_deposit` | **BLOCKED_NO_APPROVED_BOOKING_POLICY** |
| `gar.fleet.scheduled_maintenance` | **DEPENDENCY_NO_FLEET_SOURCE** |
| `gar.towing.breakdown_dispatch` | **DEPENDENCY_NO_DISPATCH_SOURCE** |

No price, Zimbabwe provider access or settlement arrangement was invented.

## 6. Beneficiary and merchant controls

- Only the runtime-guarded simulator gateway is admitted; CarUp Japan's Stripe sandbox is refused as a garage gateway
  (smoke G; inventory test). The runtime guard records who enabled it and when.
- A garage merchant account is registered and suspended only by a platform administrator; its identity is immutable;
  one live account per garage and gateway (smoke G).
- Every canonical row is third-party money of the garage (`tenant:<garage>`), never CarUp's (smoke I; HTTP case 19).
- Provider evidence naming another merchant is recorded and never applied — on the webhook / read-back path (smoke D)
  and on the F5 operator path (real-PG test). Every member of the beneficiary garage is conflicted for operator
  resolutions, like the payer (smoke H).

## 7. Migration and RLS evidence

- Integrated PostgreSQL certification, **both orders** (payments-first, garage-first): Phase 1 proves PAY-04 preserves
  OPS07 history, derived balances and canonical payments (fingerprint before = after); Phase 2 runs the certified
  PAY-01C/PAY-02/PAY-03A/PAY-03B smokes on the PAY-04 writers, then the PAY-04 smokes (integrity I1–I14, S, P; provider
  G, A, R, X, L, H, D, I, N). PASS locally and in CI at every head since `c8e45625`, including `d421965e`.
- Fresh-install catalog evidence from the UAT database built at `d421965e`:
  [rls-and-privileges.md](evidence/pay04/rls-and-privileges.md). Every `pay04_*` table: RLS on, no policy, no grant to
  `anon`/`authenticated`, `service_role` SELECT only. OPS07 tables keep FORCE RLS. Every SECURITY DEFINER writer pins
  `search_path` and is executable by `service_role` only; internal helpers by no API role.
- Upgrade path: the UAT database is the PAY-03B local recipe + the Garage chain + PAY-04 (79-entry ledger, 0 skipped).

## 8. Physical journeys — the directive's 25 cases

Runtime `d421965e` on the isolated stack (`carup-pay04-supabase`, API 56321, DB 56322; backend 5051, web 5203, both
proving the candidate SHA), fresh database, real PostgreSQL, real sessions from the product login, CSRF, the signed
simulator webhook. Evidence: [HTTP matrix](evidence/pay04/README.md) and the headed-Chromium journal and element
screenshots.

**HTTP matrix: 26/26 PASS** — runtime `d421965e`, harness `d421965e`, recorded 2026-11-02T04:52:51.929Z ([evidence](evidence/pay04/http-matrix-d421965e.json)).

| # | Directive case | HTTP matrix | Result | Note |
|---|---|---|---|---|
| 1 | Customer requests service | `1-5` | ✅ |  |
| 2 | Garage prepares estimate | `1-5` | ✅ |  |
| 3 | Customer authorizes work | `1-5` | ✅ |  |
| 4 | Authorized work is completed | `1-5` | ✅ |  |
| 5 | Parts usage is reconciled | `1-5` | ✅ | suggested part line = the recorded usage |
| 6 | Garage issues the correct invoice | `6` | ✅ | hand-typed part line and over-quantity refused; browser |
| 7 | Customer accesses the invoice | `7` | ✅ | browser |
| 8 | Partial external payment | `8` | ✅ | browser |
| 9 | Invoice balance decreases correctly | `9` | ✅ |  |
| 10 | Garage records the remaining payment | `10` | ✅ | browser |
| 11 | Receipt generated from the actual record | `11` | ✅ |  |
| 12 | Customer sees the correct provenance | `12` | ✅ | browser |
| 13 | Unauthorized customer cannot read | `13` | ✅ |  |
| 14 | Wrong garage cannot mutate | `14` | ✅ | a mechanic cannot record either |
| 15 | Duplicate payment request is idempotent | `15` | ✅ |  |
| 16 | Overpayment fails | `16` | ✅ |  |
| 17 | Wrong currency fails | `17` | ✅ | never converted |
| 18 | Reversal updates balance and receipt state | `18` | ✅ |  |
| 19 | Provider-simulated success, separately classified | `19` | ✅ | third-party garage money; zero declared rows; browser |
| 20 | Forged webhook cannot settle | `20` | ✅ | bad signature, stale, another secret |
| 21 | Partial provider refund reconciles | `21` | ✅ | F5 hold → operator resolution |
| 22 | Provider outage does not fabricate payment | `22` | ✅ | webhook 502, nothing counted, recovery confirms |
| 23 | Cancellation and adjustment preserve history | `23` | ✅ | void refused by OPS07, then by the PAY-04 in-progress guard; stop; void; re-issue |
| 24 | Desktop, tablet and mobile interfaces function | — | ✅ | headed Chromium at 1440, 768 and 390 px: axe WCAG 2 A/AA clean, no lateral overflow |
| 25 | Existing Garage and PAY-03B tests remain green | — | ✅ | CI 6/6 at `d421965e`; §11–12 |

Beyond the 25:

| Case | What | Result |
|---|---|---|
| `R` | Garage refunds a provider-confirmed payment in full; the customer is told | ✅ |
| `C1` | Five simultaneous online payments for the whole balance: exactly one reserves it | ✅ |
| `C2` | A cash record racing the reservation never over-commits | ✅ |
| `C3` | Five provider deliveries at once: one allocation, one receipt | ✅ |
| `INV` | Database invariants over every invoice of garage A | ✅ |
| `RV1` | Review U1/U5: a waiting row never claims confirmation; the invoice names the counting source | ✅ |
| `RV2` | Review M3: a billed part cannot be reversed even on a reopened work order (the legacy platform-mechanic member reopens: 200; reversal 409 "Void the invoice…"); after a void it can | ✅ |

**Headed Chromium (a visible window): 9/9 PASS** at runtime `d421965e` (spec at `fdd61726`; 7.7 min):
runtime provenance; case 6; cases 7/19 (the customer pays on the clearly-labelled simulated provider page and CarUp
confirms only from a provider read); cases 8–12 (both provenances side by side, with the provider activity); the
garage's refund (stops counting at once; the customer sees it); the operator's review of a misreported amount; case 24
at 1440, 768 and 390 px — every surface axe WCAG 2 A/AA clean with no lateral overflow. Evidence: the journal and 25
element screenshots.

How the browser runs converged (each finding fixed test-first, then re-run): axe found the money buttons below WCAG AA
(`8d4301d0`); an axe selector in the spec (`e16c9fea`); the global per-IP limiter, which every local actor shares —
the page then showed its truthful "could not be loaded" error with a retry (each test now starts in a fresh window,
`da6037df`); one Chromium process closed under memory pressure (environmental; retried); the hub, journey and invoices
list labels and the hub's missing activity (P1–P2, `d421965e`). Two passing runs at `d421965e` were repeated only to
keep the app's sticky header out of the screenshots (`2d2f88f3`, `fdd61726`).

## 9. Provider simulation and negative security tests

| Test | Evidence |
|---|---|
| Forged webhook (bad signature, stale timestamp, another secret) refused before any read or write | HTTP 20; real-PG test |
| Duplicate start replays; amount-less retry replays; a different amount under the same key conflicts | HTTP 15; smoke A; real-PG tests |
| Overpayment and wrong currency refused (never converted) | HTTP 16, 17; smoke A |
| Unauthorized customer cannot read; another garage cannot mutate; a mechanic cannot record | HTTP 13, 14 |
| Provider read outage never fabricates a payment; recovery confirms from a fresh read | HTTP 22; real-PG test |
| Provider misreports amount / currency / merchant → recorded, never applied; a later mismatch un-counts | smoke D; real-PG test; browser (operator) |
| Webhook storms apply once; one winner for the last unit of balance; refunds once | HTTP C1–C3; real-PG races; Garage races (PG16) |
| A stopped or expired checkout holds its room until the provider confirms closure | smoke X; real-PG tests |
| The provider takes no money after the expiry CarUp gave it | real-PG test |

## 10. Reconciliation and refund evidence

- Garage full refund: refund pending (not counted, receipt voided, room held) → provider confirms → refunded; the
  customer is told (HTTP R; real-PG test). A refund the provider refuses is reported as refused and the payment still
  counts; a new request uses a new provider key (real-PG test).
- Provider-side partial refund → F5 sticky hold (not counted, held) → operator final partial refund (remainder counts,
  new receipt) or restore (smoke H; HTTP 21; real-PG test). **A later provider refund after a final resolution
  de-counts and tells the operator** (smoke H5).
- Late money the invoice cannot absorb → recorded, never counted, flagged; closed by a provider refund, by an operator's
  off-platform settlement (which sticks), or automatically once room reappears and it counts (smoke D; real-PG test).
- Invariants over every invoice of the UAT garage (HTTP INV) and in the smokes (I): append-only ledger and history, one
  live receipt = counted money, gapless shared numbering, no invoice counts more than its total.

## 11. Preserved Garage OPS07 authority

- `garage_payment_records.source` vocabulary untouched (`garage_recorded_external` only) — smoke I; PAY-04 never writes
  declared payments (HTTP 19: zero declared rows for provider money).
- OPS07 history, derived balances and canonical payments identical before and after PAY-04 (Phase 1 fingerprint, both
  orders); OPS07's `garage_ops07_invoice_balance` keeps its signature and vocabulary.
- OPS07 suites: Garage new domains 120/120 and inherited 784/784 in the CI backend job (replayed locally at
  `d421965e` with CI's environment); Garage races 16/16 on PostgreSQL 16 in CI at `d421965e`.

## 12. PAY-01 / PAY-02 / PAY-03A / PAY-03B regressions

- Certified PAY smokes (PAY-01C, PAY-02, PAY-03A, PAY-03B F5, subscriptions, remediation) on the PAY-04 writers: PASS,
  both orders, locally and in CI.
- PAY-03B real-PG services on the PAY-04 schema: 29/29 (local; CI both orders).
- CI backend regressions step (PAY-03B, PAY-01A/C, PAY-02, PAY-03A): 131/131.
- F5 drift test: the re-created functions differ from F5 only in their identifier-shape lines and one garage branch each.
- Web: 3,598/3,598 at `d421965e`; `tsc -b` clean; production build; 0 net-new lint (the one error in
  `ServiceRequests.tsx` exists unchanged at the integration base).

## 13. Independent review

Two independent read-only reviews (money authority; money screens) of `0ee715ae..de1032bf` found 1 + 3 High, 3 + 8
Medium and several Low issues. Every finding was verified against the code, then fixed test-first (smokes, real-PG or
vitest RED → GREEN); one Low (a confirmation for *Check with the provider*) was pushed back with reasons — it only re-reads
the provider and cannot move money. The finding-by-finding record is the design document §11.

**Mutation proof at the runtime candidate `d421965e`: 37/37 killed** — 12 database mutants by their exact smoke
assertions, 15 service mutants by the real-PG suite, 10 web mutants by vitest, each re-introducing one fixed defect
([mutation-results.md](evidence/pay04/mutation-results.md)).

**Found in physical UAT and fixed** (each test-first): PAY-04's provider-calling routes now follow the payment routes'
sensitive-limiter convention (`31d2e23b`); WCAG 2 AA contrast of the money buttons (axe; `8d4301d0`); after the review,
the headed-browser run found the Garage Hub's step list, the customer's journey progress and the garage's invoices list
still printing "recorded by the garage" while provider money counted, and the hub missing its provider activity
(`d421965e`; design document §11, P1–P2).

**Residual observations (not PAY-04 defects):**
1. OPS04 `garage_ops04_replace_draft` uses `updated_at` (millisecond resolution) as its optimistic-concurrency token;
   two saves in one millisecond defeat the stale-save check, and its own test fails intermittently in multi-file runs.
   Owner: Garage.
2. The shared outline Button's hover state (white on the CarUp-orange accent, 2.8:1) is below WCAG AA app-wide. Owner:
   design system.
3. A hand-typed `other`/`fee` line can describe a part (its category is the garage's statement); only `part` lines are
   bound to recorded consumption.
4. Over HTTP, reopening a completed work order is open only to a legacy platform-mechanic member of the garage; the
   billing guard holds for any path (smoke I14; HTTP RV2).

## 14. Authority and environment safety

- Production: never accessed. Shared staging: never accessed or mutated (no PR opened, see §1). No provider sandbox, no
  external financial mutation, no live payment. CarUp Japan's merchant identity never used for a garage.
- The UAT stack refuses the PAY-01C/PAY-03A (54321/54322) and PAY-03B (55321/55422) evidence stacks; the certification
  script refuses anything but a local disposable `pay01c_sandbox_ci`.
- No merge of #241, #242, #250 or #251; no force-push; no rebase.
- Committed content scanned for secret shapes; the evidence sanitizer refuses any secret-shaped value.

## 15. Remaining commercial blockers

| # | Blocker | Gate | Resolver |
|---|---|---|---|
| B1 | No authorized Zimbabwe collection provider, garage merchant contract or provider credentials | Level 2 | Owner + garage + provider (PAY-05) |
| B2 | No approved deposit / cancellation policy or tariff | deposits | Owner |
| B3 | No governed retail parts-sale authority | parts retail | Product owner |
| B4 | No fleet account / contract source; no dispatch source / distance tariff | fleet, towing | Product owner + Owner |
| B5 | Merchant of record, settlement, tax treatment, legal terms, customer disclosures | Level 3 | Owner + legal |
| B6 | Production activation | Level 3 — forbidden here | Owner (separate assignment) |
| B7 | Opening a PR for this branch fires a shared-staging write in another programme's CI | PR / merge | Owner (accept that run, or gate that job first) |

## 16. GM-GC-001 continuity record

| Field | Value |
|---|---|
| Task identifier | CARUP-PAY-04-LR01 (programme issue #247) |
| Accepted baseline | Payments parent `c2d548ed` (PAY-03B, PR #251) + Garage parent `69e12e21` (Garage Final, PR #242), integrated at `3ab0d7eb` / `0ee715ae` |
| Active source owner | PAY-04 implementation specialist (this assignment) |
| Independent reviewer | `NOT_ASSIGNED` — two independent read-only review passes (money authority; money screens) were commissioned and their findings remediated (§13); they do not replace a Moderator-assigned reviewer |
| Parent / candidate SHAs | parents `c2d548ed`, `69e12e21` (unchanged on origin); runtime candidate `d421965e`; final evidence head in the specialist's return |
| Current gate | Checkpoints A–H complete at Level 1 → **awaiting Moderator** |
| Evidence types | *Test:* SQL smokes (both orders), real-PostgreSQL services (22), unit and UI suites, mutation 37/37. *Physical:* authenticated HTTP 26/26 and headed Chromium 9/9 at three widths on the isolated local stack. *CI:* exact-head (§1). *Provider:* the local simulator only — no external provider evidence (Level 2 not authorized) |
| Blockers | B1–B7 (§15), each with its resolver |
| Continuation record | this document, the design document (§11 for the review record) and the private `~/carup-launch-evidence/pay04/HANDOFF.md` |
| Next action | Moderator: accept or remediate PAY-04 at the final head. Owner: decide B7 (opening the PR) and B1 (the Zimbabwe provider). After acceptance: PAY-05 (Zimbabwe collections and mobile money) |

Progress against the PAY-04 package baseline: all eight checkpoints complete for Level 1; Level 2 is blocked on provider
and Owner authority; Level 3 is forbidden by this assignment.

## 17. Recommendation

**RECOMMEND ACCEPT** — Level 1 QA acceptance of PAY-04 at runtime `d421965e` (final evidence head in the specialist's
return). This is not commercial readiness.

- The full garage journey works on the integrated Payments + Garage line: request → estimate → authorization → work →
  parts from recorded consumption → invoice → the garage's payment instructions → declared (Mode 1) and
  provider-confirmed (Mode 2, simulated) payments → allocation → receipts → refund and reversal → customer history →
  garage overview and operator exceptions.
- OPS07 stays the invoice authority (`garage_recorded_external` only); provider money is third-party money of the garage
  on the canonical ledger; F5 is reused, not copied; no new invoice or billing authority.
- Evidence at the candidate: PostgreSQL certification in both orders; real-PG 22/22; PAY-03B real-PG 29/29; backend
  regression job replayed (18 + 120 + 784 + 131); web 3,598/3,598; HTTP 26/26 and headed browser 9/9 on a fresh isolated
  stack; exact-head CI 6/6.
- The independent review's High and Medium findings and the UAT findings are fixed test-first and proven by
  killed mutants (37/37 at the candidate). No High or Medium defect is known open in PAY-04.

Commercial activation stays blocked by B1–B6; opening the PR (B7) is the Owner's decision because of another
programme's shared-staging CI job. The residual observations in §13 belong to their owners (Garage; design system).
