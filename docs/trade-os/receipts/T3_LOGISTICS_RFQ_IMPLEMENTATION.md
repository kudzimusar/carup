# Trade OS T3 — Logistics RFQ implementation receipt

- **Programme authority:** `docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md` §10
- **Branch:** `feat/trade-os-client-demo-convergence`
- **Draft PR:** #207
- **Production:** untouched
- **Status:** T3-PARTIAL at `5958e436` — owner UAT round 1 complete (8 findings, all corrected); **ROUND 2 REQUIRED**; production untouched — everything provable without a deployed environment
  is proven; nothing on staging has been run. This receipt is evidence, **not a competing plan**.

## Why T3 exists

T2 Request Quotes answers: **“I need to buy/find something.”**

T3 answers a different user intention: **“I already own or bought cargo and need to move it.”**

A logistics request is therefore not stored as a procurement order and is not created as a cargo reservation. A reservation is only created after an actual logistics offer is selected and, for a CarUp shared-container offer, the participant explicitly requests space. That reservation remains `REQUESTED`; the existing organiser-side atomic approval remains authoritative.

## Current implementation cycle

### New authoritative schema

Migration:

`database/migrations/20260905090000_trade_os_logistics_rfq.sql`

Adds:

- `diaspora_logistics_requests`
- `diaspora_logistics_request_items`
- `diaspora_logistics_quotes`
- atomic `diaspora_accept_logistics_quote_atomic(...)`

The request is private while `DRAFT`, market-visible through a safe projection only when `OPEN_FOR_QUOTES`, and becomes `AWARDED` only through the atomic quote-selection RPC.

### Cargo model

Current cargo categories:

- vehicle
- parts
- household / personal effects
- furniture / appliances
- boxes / cartons
- machinery / equipment
- pallet / crate
- general eligible cargo
- other eligible cargo

Per cargo group the model can record:

- plain-language description
- quantity
- L × W × H
- cm / m
- calculated estimated CBM
- provider/customer-supplied estimated CBM
- estimated weight
- `CALCULATED` / `PROVIDED` / `UNKNOWN` measurement basis
- optional governed linked Vehicle VIN
- notes

Unknown measurements remain `NULL`/`UNKNOWN`; they are never replaced with zero.

### Vehicle-link security

`linked_vehicle_vin` is checked server-side with the canonical `resolveVehicleObjectAuthority` before item writes.

The HTTP create/update routes also preflight all linked VINs **before request-header mutation**, so a forged vehicle link cannot leave an orphan request or partially updated route state.

Missing/foreign VINs are non-enumerating at the public boundary.

### Provider eligibility

A logistics provider is a commercial context, not a new global role.

Provider-side opportunity/quote access is derived from:

`user_registration_profiles.business_type = logistics_provider`

plus authenticated tenant context. Platform review roles retain governed oversight.

### Marketplace privacy

Provider discovery returns an explicit allow-list projection. It excludes:

- requester user id
- tenant id
- email / phone
- unrelated CarUp records
- linked vehicle VIN

A provider may see only that a vehicle is linked, not the VIN itself.

Provider draft offers remain private to the provider; requester HTTP reads exclude `DRAFT` logistics quotes.

### Customer experience

New T3 Shipping workspace under the existing Trade OS operational shell:

`/diaspora/containers`

The route now presents three operational modes rather than treating container co-loading as the whole logistics product:

1. **My shipping** — request quotes for cargo already owned/bought;
2. **Provider requests** — visible only for a real logistics-provider commercial profile;
3. **Container space** — the existing hardened Container Co-Loading surface, preserved intact.

Customer wizard:

`Cargo → Size & weight → Route → Review → Publish`

It is intentionally written for non-freight users:

- plain-language cargo categories;
- multiple item groups;
- `Help me calculate it`;
- `I know the total volume`;
- `I don't know yet`;
- explanation of CBM;
- estimates explicitly remain estimates;
- privacy preview before publish.

### Logistics provider experience

Provider workspace supports:

- safe open opportunities;
- requester-private discovery;
- service mode;
- optional real CarUp container sailing;
- freight charge;
- handling;
- origin charges;
- destination charges;
- document fees;
- offer total + currency;
- stated transit time;
- validity;
- pickup included / not included / not provided;
- delivery included / not included / not provided;
- inclusions;
- exclusions;
- conditions;
- draft/edit/submit/withdraw lifecycle;
- explicit **Review offer** before submission.

Unknown fee components stay `Not provided`; the UI does not call a total “all-in” when components are absent.

### Container connection

A logistics provider may attach a CarUp container only when the server proves they coordinate/administer that sailing.

The sailing must be:

- `BOOKING_OPEN`;
- route-compatible by recorded origin/destination country.

Customer-side compatible-sailing discovery uses:

- real open containers;
- actual approved-reservation capacity recomputed by the existing capacity engine;
- route compatibility;
- cargo estimated volume when all item groups have one.

Matching is read-only and always reports that organiser confirmation remains required.

After a shared-container offer is selected:

`Selected logistics offer → Request container space → REQUESTED reservation → organiser reviews → existing atomic approval`

The conversion is idempotent and carries the logistics request/quote references in reservation metadata. It does **not** auto-approve capacity.

### Communications

No logistics-specific chat table was created.

Requester/provider clarification uses canonical CarUp Communications reference-flow infrastructure with a logistics-request subject reference.

### Current test additions

Backend:

`backend/tests/diaspora-logistics-rfq.test.js`

Pins:

- safe marketplace projection;
- logistics-provider eligibility;
- cross-tenant discovery;
- deterministic CBM calculation;
- unknown measurement truth;
- foreign/own VIN authorization;
- foreign/own container authority;
- no reservation on mere quote submission;
- route + recomputed-capacity sailing matching;
- matching remains read-only.

Web mocked comprehension:

`web/e2e/trade-shipping-rfq.spec.ts`

Pins:

- layman shipping-request entry;
- unknown-size path;
- guided dimensions;
- privacy/review messaging;
- provider opportunity workspace;
- transparent charge composer;
- review-before-submit;
- provider-safe opportunity display.

## Stabilization and completion cycle — head `afa80e35`

The three receipt gaps below are now **closed**, and two real defects were found while stabilizing
the previous head. The canonical record is the execution entry
"2026-09-05 · T3 stabilization and completion cycle" in the master plan §30; this section is the
short form.

### Closed since `f6c10e9b`

- **T2 → T3 handoff.** `Ship something` no longer claims multi-provider logistics quotation is
  unavailable. It leads with *Ask providers to quote → Create a shipping request*, keeps
  *Find container space* as the direct second route, and never shows internal RFQ terminology.
- **CarUp vehicle identity reuse.** A vehicle cargo group offers the requester's own vehicles from
  `/api/vehicles/me` — a strict subset of what `resolveVehicleObjectAuthority` permits, so the
  picker can never offer a vehicle the server would refuse. Not-read, genuinely-empty and
  read-FAILED stay three distinct states, and a failed read never blocks manual capture.
- **Lifecycle notifications.** Decided for T3 rather than deferred: three outbox events on the
  existing Communications authority (`quote_submitted` / `quote_accepted` / `quote_not_selected`),
  no new notification store or chat authority. DRAFT emits nothing, WITHDRAWN is never told it
  lost, and an idempotent acceptance replay re-notifies nobody.

### Defects found and fixed

- The logistics provider could never land on `Provider requests`: the tab was seeded from
  `useState` before the shell had fetched the trade context, so `isProvider` was always false at
  seed time. The tab is now derived during render and lives in the URL.
- Wrapping `/diaspora/containers` in the Shipping workspace bypassed the container product's own
  access-denied gate, giving an unauthorized role a working shipping surface. The workspace is now
  gated on the canonical Feature Registry rule.
- A 393px horizontal overflow in the offer composer (a `w-24` appended to a class string already
  carrying `w-full`, which narrows nothing).

### Verified at this head

`tsc` clean · lint gate `NET_NEW_ERRORS=0` · backend 41/41 across the T3, T3-adversarial and
container-auth suites · communications coverage 9/9 · browser 48/48 across
`trade-shipping-rfq` (7), `diaspora-container-marketplace` (16) and `trade-request-quotes` (25).
Adversarial matrix and seven-viewport geometry both proven — see §30 for the itemized list.

## Staging activation — three defects only a real database could show

The migration is now applied to **staging only**. Applying and exercising it found three defects
that every local suite had been green through. Full detail is in the master plan §30 entry
"T3 staging schema activation"; in short:

1. **No Row Level Security** on any of the three new tables, while every sibling Diaspora trade
   table has carried it since `013`. The logistics demand book would have been readable with the
   anon key — making the marketplace projection decorative. RLS now on, sibling policy applied.
2. **The award RPC was executable by `anon` and `authenticated`.** `REVOKE … FROM PUBLIC` is not
   enough on Supabase, which grants the API roles directly. Now `anon=false, authenticated=false,
   service_role=true`, matching both hardened siblings.
3. **The award RPC failed every call** with `42883 function digest(text, unknown) does not exist` —
   pgcrypto lives in `extensions`, not `public`. T3's atomic award was 100% broken against a real
   database. `migration-integrity` now guards this class permanently.

Award authority then measured on real Postgres: provider / privileged-provider / stranger / NULL
actor all refused with the request untouched; the requester's award produced exactly one ACCEPTED,
one REJECTED, one audit row with a 64-character seal, an idempotent replay that wrote no second
row, and **zero reservations** — an award is not a booking. Fixture removed afterwards.

## Deployed-staging certification

`tests/agents/47-trade-os-t3-staging.spec.ts`, registered additively in the staging harness, runs
the journey **unmocked** on the deployed candidate in `mode=acceptance` with the served bundle
pinned. 3/3 on desktop, tablet and mobile.

Pairing was proven first: the branch preview issues API calls only to the branch backend, with
zero to the shared staging backend and zero to production. Fixtures were created through the real
public registration API, which also demonstrates that provider eligibility is a registration
profile (`business_type: logistics_provider` on an ordinary `owner` account), never a platform
role.

Data measured across all four staging runs: 4 requests, 4 AWARDED, 4 accepted quotes of 4,
`estimated_volume_cbm` `1.512` basis `CALCULATED` computed by the real backend, 8 lifecycle events
(`quote_submitted` → requester, `quote_accepted` → provider), and — the invariant that matters —
**0 container reservations**. An award is not a booking.

## Post-closure re-certification — head `232b68c3`

The interim hardening was preserved and the adversarial audit's remaining confirmed findings were
closed (governed-template registration, withdrawn-DRAFT disclosure, unknown-CBM dead end →
fill-only confirm-measurements, 0.000-CBM refusal before write, DB-scoped my-requests, cleared-charge
merge semantics, reservation-state read-back, winner-not-selected notification, four vacuous tests).

All thirteen targeted hardening proofs (A–M) then ran against the DEPLOYED exact head — FE bundle
`index-BPPgy9UI.js` and BE both from `232b68c3` — with API/database assertions, and the full
requester → provider → award → container-space → organiser-approval journey passed **6/6** across
desktop, tablet and mobile in `mode=acceptance`. CI is green on the same head. The itemized A–M
table lives in the master plan §30 entry "T3 post-closure re-certification".

## Owner UAT round 1 → corrections at `5958e436`

The owner walked SHIP-9D8120DA end to end on desktop and mobile and returned eight findings; all
are corrected and re-certified on the deployed build (`index-DbaX20hJ.js`, spec 47 6/6 across three
viewports). Detail is in the master plan §30 entry "OWNER UAT ROUND 1".

Two entries are worth carrying here because they are corrections to the record, not just to code:
finding 4 ("Loading business context…") was reported as never resolving; measurement showed it
always returns in 1.5–2.5s, so the fix is an affordance plus a terminal guarantee rather than a
hang fix. And one spec-47 run failed because the shared fixture sailing had reached 45.296/47 CBM —
the container product correctly refusing overfill, which is the guard working; the fixture needs
periodic reset.

## Known work still required before T3 closure

1. **OWNER UAT ROUND 2** on the corrected build — round 1 produced findings, not a pass, and
   automation cannot close it (§29). See `docs/trade-os/T3_OWNER_UAT_GUIDE.md`.

The other four items from the closure correction are now closed — see the master plan §30 entry
"T3 final closure correction":

- **shared-container conversion** is a repeatable spec, not a hand measurement: REQUESTED consumes
  0, replay is idempotent, a foreign sailing is refused, and approval consumes exactly the reserved
  volume. Measured on the fixture: `total 47 · used 3 · available 44`, with **3 REQUESTED
  reservations consuming nothing** alongside the single APPROVED one.
- **the route boundary** enforces the registry again: nav visibility equals typed-URL eligibility,
  pinned for all seven roles. `/diaspora/imports/:id/passport` was unregistered and rendering as
  PUBLIC; that is closed too.
- **taxonomy RLS drift** reconciled by forward migration, with a generalised migration-integrity
  guard covering the class.
- **CI** re-confirmed on the final candidate.

**T3 is T3-PARTIAL.** Saying "only owner UAT remains" was an overclaim and is corrected above. Do not call it usable/client-ready/production-ready, and do not begin T4, until all five clear.

---

## T3 CERTIFICATION INFRASTRUCTURE HARDENING — run-scoped sailing

**Classification: certification infrastructure, not product.** No runtime product behaviour was
changed; the Owner UAT Round 2 candidate `5958e436` is preserved intact.

### What was wrong

The staging certification depended on a shared fixture sailing. Each run approved 3 CBM into it and
never gave the capacity back, so the fixture ratcheted toward full (**9.000/47** after three runs;
**45.296/47** after ~24, where a healthy run failed because the container product correctly refused
overfill). Isolation depended on someone resetting a shared row by hand.

### What it is now

Spec 47 creates its own sailing per run **and per viewport project** — three projects execute the
same journey, so a single per-run sailing would still be shared three ways. Reference
`golden.t3.sailing.<run>.<project>`, written to `origin_city` (a field the matcher ignores; only
countries are matched) so the operator surface shows plainly that the sailing is scaffolding and
which run owns it.

Created through the governed operator API — `POST /container-marketplace/containers` — never seeded
behind the product. `createContainer` makes the creator the `coordinator_id`, and
`assertProviderMayOfferContainer` admits the coordinator, so the provider attaches its own sailing
through the same authority a real operator passes. `apiAs` now sends `x-tenant-id` from the stored
user's `active_tenant_id` exactly as the app does, because `authorizeRole` only reads `tenant_users`
when that header is present — without it, creation is refused 403.

### Exact proof (real staging, governed API)

```
CREATE            201   coordinator === caller: true   BOOKING_OPEN
  total / used / available            24 / 0 / 24
CAPACITY                       usedVolume 0, availableVolume 24
RESERVATIONS                   count = 0   (nothing inherited)
CLEANUP close-booking          200 → BOOKING_CLOSED
```

### Replay semantics

Replaying `request-space` still returns `idempotentReplay=true`, and the spec now also re-reads the
manifest to assert the reservation count is **still exactly 1** — previously only the flag was
checked. Re-approving an already-APPROVED reservation is asserted not to consume capacity twice.

### Cleanup semantics

The run closes booking on its own sailing, best effort, touching nothing else. A future run never
depends on it having worked, because that run creates its own sailing. Structural isolation over
cleanup.

### Drift guard

`backend/tests/trade-os-t3-certification-isolation.test.js` — 8 tests in ordinary CI. Pins the
architecture rather than an id: governed creation, no shared default, empty starting ledger, no
inherited reservations, id-based selection with no `.first()`, run-scoped reference, every preserved
capacity invariant, the DOM identities, and best-effort cleanup. Mutation-tested: reverting to a
hardcoded sailing, deleting the empty-ledger assertion, and removing the card attribute each failed
exactly one test and no others.

### Verification at this head

| Gate | Result |
|---|---|
| Drift guard | 8/8 |
| `diaspora-logistics-rfq` + `diaspora-container-marketplace` | 25/25 |
| Governed create/capacity/cleanup on staging | 201 / 0-used / 0-inherited / closed |
| `tsc --noEmit` (web app + spec) | clean |
| `lint-baseline-gate` | NET_NEW_ERRORS=0, NET_NEW_WARNINGS=0 |
| `npm run build` | built |
| Playwright collection | 2 tests × 3 projects = 6 |

Spec 47's own 6/6 browser run is **not re-run at this head**: it requires the branch preview to be
redeployed, which would move the bundle the owner is inspecting for UAT Round 2 (`index-DbaX20hJ.js`
→ `index-BFDpNUlS.js`). It is deliberately deferred until Round 2 concludes.

**Owner UAT Round 2: PENDING. T3 remains T3-PARTIAL. T4 not begun. Production untouched.**
