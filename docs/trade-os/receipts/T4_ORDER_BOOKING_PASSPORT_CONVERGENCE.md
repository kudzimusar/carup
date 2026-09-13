# T4 — Order & Booking Passport Convergence

**Starting SHA:** `04558148` · Branch `feat/trade-os-client-demo-convergence` · Draft PR #207
**T3 frozen at `b446d8ea` — not modified by this work.**
Production untouched. T5 not started.

---

## 1. Authority audit (performed BEFORE any code, per §3/§13)

### What already exists and is canonical

| Concern | Authority | Anchor |
|---|---|---|
| Procurement order | `diaspora_import_orders` | `id`, `buyer_id`, `tenant_id`, `status` |
| Procurement offers | `diaspora_import_quotes` | `import_order_id`, `seller_id`, `stock_item_id`, `status` |
| Order participants | `diaspora_import_order_participants` | `import_order_id`, `user_id`, `trade_profile_id` |
| Logistics request (T3) | `diaspora_logistics_requests` | `id`, `requester_id`, `tenant_id`, `status`, `accepted_quote_id` |
| Logistics offers (T3) | `diaspora_logistics_quotes` | `logistics_request_id`, `provider_id`, `provider_tenant_id`, `compatible_container_id` |
| Container sailing | `diaspora_container_shipments` | `id`, `coordinator_id`, capacity columns |
| Reservation | `diaspora_cargo_reservations` | `container_id`, `import_order_id`, `metadata->>'logistics_request_id'` |
| Shipment | `diaspora_shipments` | `import_order_id`, `container_id` |
| Documents | `diaspora_trade_documents` | `import_order_id` |
| Communications | canonical `stakeholderService.ensureReferenceFlow` | T2 `diaspora_rfq` / T3 `diaspora_logistics_request`, both workflow `marketplace` |
| Audit | `diaspora_import_audit_log` + `appendAudit` | per-resource |
| Events | `emitDomainEvent` | `diaspora.rfq.*`, `diaspora.logistics.*`, `diaspora.container_booking.*` |

**`getImportOrder` already aggregates** participants, quotes, trade documents, cargo reservations,
shipments, compliance reviews and payment milestones in one read. T4 reuses this rather than
rebuilding it.

**Communications is already converged at the authority level.** T2 and T3 both call the same
canonical `ensureReferenceFlow` with workflow `marketplace`, differing only in `subject_type` and a
`<anchor>:<counterparty>` `subject_id`. No second messaging system is needed or permitted.

**T3's reservation linkage, measured:** the reservation ↔ logistics-request link lives in
`diaspora_cargo_reservations.metadata->>'logistics_request_id'`, protected by the partial unique
index `uq_diaspora_cargo_reservation_live_logistics_request` (live REQUESTED/APPROVED only). The
reverse pointer is `diaspora_logistics_requests.metadata->>'reservation_id'`.

### The gaps T4 must close

| # | Gap | Evidence |
|---|---|---|
| **G1** | No logistics-origin passport exists at all | the only passport is `/diaspora/imports/:id/passport`, anchored on `diaspora_import_orders` |
| **G2** | No link from a logistics request to a procurement order | `diaspora_logistics_requests` has no `import_order_id`; §8 "no re-entry" is impossible today |
| **G3** | The headline state is a raw single-table enum | the passport renders `labelize(order.status)`; it cannot say "container space approved" when the reservation proves it |
| **G4** | Stage derivation exists only in the frontend | T3's `transactionStage()` lives in `TradeShippingRequests.tsx` — untestable server-side, unshareable between origins |
| **G5** | Neither passport surfaces the transaction's conversations | the canonical binding exists; nothing projects it onto a transaction |
| **G6** | Documents anchor only on `import_order_id` | a pure logistics-origin transaction has no document anchor |

---

## 2. Authority decision — NO new transaction table

**New persistence authority added: ONE NULLABLE COLUMN. No new table.**

The audit shows existing authorities can express every T4 fact except exactly one relationship:
*"this shipping request is moving the goods from that purchase."* That is a single edge, not an
entity, so it is modelled as a single nullable foreign key on the authority that already owns the
shipping request:

```
diaspora_logistics_requests.import_order_id  uuid NULL REFERENCES diaspora_import_orders(id)
```

- **NULL** for a logistics-origin transaction — the overwhelmingly common case, and the reason the
  column is nullable. §4B forbids manufacturing a procurement order for cargo the user already
  owns, and a nullable column is precisely what avoids it.
- **Set** only when a buyer continues an awarded procurement into logistics, which is what makes
  §8 (no re-entry of item facts) achievable.

Idempotency (§9) is enforced in the database, not in React: a partial unique index permits at most
ONE live continuation per order, mirroring T3's proven `uq_diaspora_cargo_reservation_live_logistics_request`
pattern.

**What the column owns:** the edge, and nothing else.
**What it does NOT own:** every fact remains canonical where it already lives — vehicle facts,
quote totals, cargo measurements, container capacity, reservation state, messages, documents,
shipment state, Trust, user identity, tenant identity. The passport reads them; it never copies them.

**A `trade_transactions` table was considered and rejected.** It would duplicate an identity that
`diaspora_import_orders.id` and `diaspora_logistics_requests.id` already provide, and every fact it
held would be a second copy of a canonical row — the exact shadow duplication §3 forbids.

### Deliberately NOT done (deferred, with owners)

- **No `logistics_request_id` on `diaspora_trade_documents` (G6).** Document anchoring for
  logistics-origin transactions belongs to **T8 — Documents & Evidence workspace**. Until T8 owns
  it, a pure logistics-origin passport states its document position as *not recorded* rather than
  inventing an anchor. Unknown stays unknown (§12).
- No shipment path for logistics-origin — **T11** owns that transition.

---

## 3. What was built

| Piece | File | Role |
|---|---|---|
| The one new schema fact | `database/migrations/20260906090000_trade_os_t4_transaction_continuation_link.sql` | nullable FK + lookup index + partial unique index |
| Stage projection (pure) | `backend/services/diaspora/tradeTransactionStage.js` | furthest proven stage, on the SERVER |
| Passport projection | `backend/services/diaspora/tradeTransactionPassportService.js` | participant-scoped, owns no facts |
| Routes | `backend/routes/diasporaContainerMarketplaceRoutes.js` | `GET /diaspora/trade-transactions/:kind/:id`, `POST /diaspora/import-orders/:id/continue-to-logistics` |
| Converged surface | `web/src/pages/diaspora/TradeTransactionPassport.tsx` | one page, both origins |
| Registry + route | `web/src/App.tsx`, `web/src/config/featureRegistry.ts` | typed-URL access == navigation eligibility |
| Service tests | `backend/tests/trade-os-t4-transaction-passport.test.js` | 25 tests |
| Constraint gate | `database/test/trade_os_t4_continuation_check.mjs` + a CI step | 11 checks on real Postgres |

`kind` is a PATH segment, not a query flag, so a purchase and a shipment can never be conflated by
a missing parameter.

### Stage projection

Ladder: `DRAFT → OPEN_FOR_OFFERS → OFFERS_RECEIVED → COUNTERPARTY_SELECTED → SPACE_REQUESTED →
SPACE_APPROVED`, each carrying the fact that proves it. It reports the furthest proven stage — an
awarded request whose reservation is APPROVED reads *"Container space approved"*, not *"Provider
selected"* — and stops there. `WAREHOUSE_INTAKE`, `LOADING`, `SHIPMENT`, `CUSTOMS` and `HANDOVER`
report `NOT_STARTED` / `NOT_CONNECTED` / `NOT_RECORDED`, because their authorities are owned by
T9–T12 and unknown is not zero.

It lives on the server as a pure function specifically because T3's equivalent lives inside a React
component, where it cannot be tested alone or shared between origins.

### Privacy carried forward, not relaxed

T3's DRAFT-offer allow-list is enforced in T3's **route**, so a service-level caller reads straight
past it. It is duplicated in the T4 service deliberately, and a test pins the two copies equal so
they cannot drift. The awarded provider sees the transaction but never the requester's identity or
a cargo VIN — only `has_linked_vehicle`.

## 4. Test matrix

**Backend service — 25/25** (`node --test backend/tests/trade-os-t4-transaction-passport.test.js`)
covering: furthest-stage derivation; APPROVED ≠ loaded/shipped/cleared/delivered; REQUESTED
consumes nothing; no container → no booking claimed; capacity read from the container authority;
unknown measurements stay unknown; requester/provider/rival/stranger/anonymous authorization;
DRAFT-offer privacy and its anti-drift pin; procurement origin; the continuation edge in both
directions; no manufactured procurement order; document authority absence stated truthfully;
no-re-entry prefill; idempotent replay; concurrent activation; award precondition; buyer-only
authority; canonical Communications binding; no storage paths or URLs in the payload; unknown kind
refused; and the pure ladder's no-skip/no-leap properties.

**Real Postgres — 11/11** (`node database/test/trade_os_t4_continuation_check.mjs`, wired into CI as
its own step and **confirmed executing** there): Up applies; a second LIVE continuation is rejected
with `uq_diaspora_logistics_request_live_import_order`; another order is unaffected; NULL edges never
collide; CANCELLED, CLOSED and soft-deleted continuations each FREE the slot; the edge is a real
foreign key; Down reverses and removes the column.

That CI step exists because `migration_pglite_check.mjs`'s `NEW_MIGRATIONS` list ends at
`20260810120000`, so this migration would otherwise have been executed by **no gate at all** —
`migration-integrity.test.js` only parses markers.

**Mock divergence, recorded.** `UNIQUE_INDEXES` in the shared mock cannot express a predicate, so
its entry is stricter than Postgres in one direction: it does not free the slot after CANCELLED or
CLOSED. That half is proven against real Postgres instead, and the mock comment says so.

**Other gates:** T3 suite 12/12 unchanged (freeze preserved) · T4+T3+container+migration+isolation
85/85 · web unit 1572/1572 (feature manifest regenerated) · `tsc --noEmit` clean ·
`lint-baseline-gate` NET_NEW 0/0 · `npm run build` ✓ · **CI 7/7** at `8fc31aaa`.

**Pre-existing local failures, not T4.** A full local `node --test backend/tests/*.test.js` shows 12
failures across `verification-session-workflow`, `verification-ocr-provenance`,
`verification-terminal-and-consistency` and `provision-staging-qa-accounts`. Verified by stashing
every T4 change and re-running at `04558148`: the baseline produces the **identical 25 failure
markers** in the same four files. They pass in CI, so they are local-environment dependent. Not
introduced here, and not fixed here.

## 5. Staging certification

FE `index-CrOj-Kvb.js` · BE `/api/health → commit_sha 8fc31aaa` · same branch pair.

**Logistics-origin passport, unmocked on deployed staging** (`SHIP-54829F7F`):

```
stage            SPACE_APPROVED  "The organiser approved the container space"
sailing          SAIL-2BACA5F7   {total 24, used 3, available 21}
reservation      APPROVED  consumes_capacity=true
continued_from   null            (no procurement order manufactured)
documents        authority=false (stated, not faked)
lifecycle        …SPACE_APPROVED:CURRENT  WAREHOUSE_INTAKE:NOT_STARTED  LOADING:NOT_STARTED
                 SHIPMENT:NOT_CONNECTED  CUSTOMS:NOT_RECORDED  HANDOVER:NOT_RECORDED
communications   diaspora_logistics_request / marketplace
```

**Participant scoping, proven against the same live transaction:** the awarded provider gets
`viewer_role=provider`, `requester id = null (withheld: true)`, no VIN field at all, and a full
payload scan shows `VIN leaked: false`, `requester leaked: false`.

**Responsive, on the deployed build**, at 393×852, 820×1180, 1024×768, 1280×800, 1366×768,
1440×900, 1536×864: `scrollWidth <= innerWidth + 1` at **all seven**; 0 console errors; 0 5xx;
0 unexpected 4xx.

### Staging schema (authorized, staging only)

`20260906090000_trade_os_t4_transaction_continuation_link.sql` applied to the STAGING Supabase
project through the approved migration authority. Ledger entry
`20260905151925 trade_os_t4_transaction_continuation_link`. Verified independently afterwards:

```
column   import_order_id            uuid nullable=YES
FK       diaspora_logistics_requests_import_order_id_fkey
         FOREIGN KEY (import_order_id) REFERENCES diaspora_import_orders(id) ON DELETE SET NULL
lookup   idx_diaspora_logistics_requests_import_order
         WHERE deleted_at IS NULL AND import_order_id IS NOT NULL
unique   uq_diaspora_logistics_request_live_import_order
         WHERE deleted_at IS NULL AND import_order_id IS NOT NULL
           AND status <> ALL (ARRAY['CANCELLED','CLOSED'])
```

**Production verified untouched:** the column count in the production project is **0**.

### PROCUREMENT-ORIGIN journey, unmocked on deployed staging

`ORD-C1F0F150` → `SHIP-18F70CAB`:

| Step | Result |
|---|---|
| create procurement request | 201 |
| publish RFQ | 200 |
| supplier offer recorded | 201 (`ISSUED`) |
| accept offer | 200 |
| procurement passport | `COUNTERPARTY_SELECTED` — *"An offer has been accepted"*, USD 8200 (`QTE-C54D6E27`), supplier present |
| continue to logistics | **201**, `import_order_id = c1f0f150…`, route inherited (`SYNTHETIC … Yokohama / Japan → Harare / Zimbabwe`), status `DRAFT` |
| inherited cargo | **1 line** — "Toyota Aqua", `measurement_basis UNKNOWN`, volume **null**, weight **null** |
| replay | 200, `idempotentReplay=true`, same request |
| **4 concurrent** | all 200, **one** id returned, **no raw 23505**, all resolve to the winner |
| passport after continuation | `shipping_continuation → SHIP-18F70CAB` |
| logistics side | `continued_from_order → ORD-C1F0F150` |

**Refusal proven first:** before an offer was accepted, `continue-to-logistics` returned 400
*"Accept a supplier offer before arranging shipping for this order"* — you cannot ship what you
have not bought.

**No duplicated authority:** the shipping request holds the edge and the inherited route only.
Quote totals, supplier identity and order status stay in the procurement tables and are read, never
copied.

#### A real defect this journey caught — and only this journey could

The first deployed run returned **201 with zero cargo lines**. The API looked healthy; the
"no re-entry" guarantee that is T4's core acceptance condition was silently broken. Two causes:

1. `cargo_category` is a **lowercase** vocabulary (`'vehicle'`); `'VEHICLE'` violates the CHECK.
2. **The insert's error was never inspected**, so the violation failed silently and the endpoint
   still answered 201.

The second is the one that mattered — a loud failure would have been caught the first time. Both are
fixed in `3a3d729e`, along with a latent hazard on the same path: `linked_vehicle_vin` is a FOREIGN
KEY to `vehicles`, so carrying a VIN the order merely mentions would fail the insert whenever no such
row exists *and* would assert a vehicle link CarUp has not authorised. The VIN is now carried only
when the vehicle exists **and belongs to the buyer**; otherwise the line keeps the descriptive
vehicle context with no link. The continuation also now **converges**: a replay repairs a request
whose cargo line is missing, so a transaction that hit this once is not blank forever.

Two regression tests added (unowned-VIN, missing-cargo repair). No local suite could have caught
this — the mock has no CHECK constraints.

### LOGISTICS-ORIGIN, re-proven on the same final candidate

`SHIP-54829F7F`: `SPACE_APPROVED` — *"The organiser approved the container space"*; sailing
`SAIL-2BACA5F7` at **24 total / 3 used / 21 available**; reservation `APPROVED`,
`consumes_capacity=true`; `continued_from_order = null` (**no procurement order manufactured**);
documents `authority=false` (stated, not faked); lifecycle `…SPACE_APPROVED:CURRENT`,
`WAREHOUSE_INTAKE:NOT_STARTED`, `LOADING:NOT_STARTED`, `SHIPMENT:NOT_CONNECTED`,
`CUSTOMS:NOT_RECORDED`, `HANDOVER:NOT_RECORDED`. Capacity remains owned by the container authority.

### SECURITY, on deployed staging

| Check | Result |
|---|---|
| requester → own logistics passport | 200 |
| buyer → own procurement passport | 200 |
| unrelated user → logistics passport | **403** |
| unrelated user → procurement passport | **403** |
| anonymous → logistics passport | **401** |
| anonymous → procurement passport | **401** |
| unrelated user → continue-to-logistics | **403** |
| non-awarded provider → logistics passport | **403** |
| awarded provider → logistics passport | 200, requester **withheld**, no VIN field |
| stranger payload leaks requester id / any reference | **false / false** |
| legit payload exposes `storage_path`, `document_url`, `service_role`, `tenant_users`, `deleted_at`, `created_by` | **all false** |

The unrelated identity was created through public registration for this run (owner, no tenant).
Public registration **cannot** self-grant `dealer` — it fails closed to `owner` — and that control
was not worked around.

### DEPLOYMENT

FE `https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app`, bundle
**`index-DNz56QRa.js`** · BE
`https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app`,
`/api/health → commit_sha 3a3d729e` · same branch pair · staging Supabase project.

A bundle hash identifies the BUILD that was measured, not a reproducible hash of source.

### RESPONSIVE

Both surfaces, on the deployed build, at 393×852, 820×1180, 1024×768, 1280×800, 1366×768,
1440×900, 1536×864 — `scrollWidth <= innerWidth + 1` at **all seven**, **0** console errors,
**0** 5xx, **0** unexpected 4xx.

The procurement passport renders **"Supplier selected"** and the logistics one **"Container space
approved"**, each with its evidence line — human product language, and the origin-specific wording
proves the procurement label path is live.

### GATES

Backend (T4 + T3 + container + migration-integrity + T3 isolation) **87/87** · real-Postgres T4 gate
**11/11** · web unit **1572/1572** · `tsc` clean · lint NET_NEW **0/0** · build ✓ · **CI 7/7** at
`3a3d729e`.

**Both T4 gates confirmed EXECUTING in CI**, not merely present: the PGlite step reports `success`
by name, five T4 service subtests appear in the log (including both new regressions), and the
constraint-rejection and slot-release checks appear in the PGlite output.

## 7. Known limitations

- **The cancel/close slot-release predicate cannot be exercised on staging** — not because it is
  wrong, but because **nothing in the codebase writes `CANCELLED` or `CLOSED` to a logistics
  request**. T3 shipped no cancel capability. The predicate is proven on real Postgres (checks 5–7
  of the gate). Product consequence worth naming: today a buyer who starts shipping for an order
  cannot start a different one for that order, because nothing can free the slot. The index is
  built for the capability that should exist; the capability is a T-phase gap.
- **Documents for a pure logistics-origin transaction** have no anchor (`diaspora_trade_documents`
  keys on `import_order_id`). Stated as unknown, not faked. Owner: **T8**.
- **No shipment path for logistics-origin.** Owner: **T11**.
- **The legacy `DiasporaOrderPassport` remains** as the compliance record; the two surfaces link to
  each other. Absorbing it belongs with T8/T12/T13.
- **Intelligence pairing is event-level only** — no new event types, no dashboards (T15).
- Twelve local `verification-*` failures are **pre-existing**: stashing every T4 change reproduced
  the identical 25 markers at `04558148`. They pass in CI.

## 8. Status

**T4-PARTIAL**, remaining for exactly one reason: **OWNER VISUAL / PRODUCT UAT.**

Every technical gate passes on the exact deployed candidate, for both origins. T3 remains frozen at
`b446d8ea` and green. Production untouched. T5 not started. PR #207 Draft.

---

## 9. OWNER UAT: PASS WITH FINDINGS → UX CLOSURE → **T4-USABLE**

**Owner T4 UAT verdict: PASS WITH FINDINGS.** The convergence architecture was accepted; three HIGH
findings blocked the freeze because the passport was hard to *understand*, not because it was
untrue. The findings are kept in the record below exactly as they were found.

### What the UAT found, and what was done

| # | Finding | Class | Blocked freeze | Closure |
|---|---|---|---|---|
| **F1** | Passport printed internal user ids (`u_75baf4fa3c9a4f29`) under "Who is involved" | UX/DESIGN | YES | Identity resolves business/trading name → governed person's name → **ROLE**. No id fallback exists by construction; a test pins that no raw id can reach `participants` for any viewer. Withheld parties render by role and say they are not shared — T3's contract unchanged. |
| **F2** | Passport never answered "what should I do next" | MISSING CAPABILITY / UX | YES | Server-derived `next_step` from the same authoritative facts as the stage. Links to the canonical workspace, never reimplements it; a blocked step names what is missing; a pending space request shows WAITING, not a duplicate CTA. |
| **F3** | "Arrange shipping" created a correct DRAFT then left the user at a soft dead-end | UX/DESIGN | YES | The next step carries **"Continue shipping request"** straight to that draft. The continuation still begins as DRAFT deliberately — a procurement award is not a published logistics RFQ, and nothing publishes on the customer's behalf. |
| **F4** | Messages stated where the conversation lives with no way to open it | UX/DESIGN | no | **"Open conversation"** link to canonical Communications. No second inbox. |
| **F5** | Procurement passport showed "Japan → Zimbabwe" while the order recorded Yokohama/Harare | DEFECT | YES | The recorded city is no longer discarded. |
| **F6** | Supplier UI not walkable with the available fixture | UAT LIMITATION | no | **No product change.** `/diaspora/buyer-requests` requires governed `dealer` authority and public registration correctly refuses to grant it. Recorded as a certification-fixture improvement: future UAT needs a governed supplier tenant fixture. |
| **F7** | Mobile nav read as accidentally chopped at 393px | UX/DESIGN | no | The nav already scrolled; a trailing fade now says so. Nothing hidden, no text shrunk. |

### Closure verified on the deployed candidate `736f06c5`

FE `index-Bks3yTmb.js` · BE `/api/health → commit_sha 736f06c5` · paired.

Four passport states walked (procurement with a draft continuation, the DRAFT continuation itself,
an awarded logistics transaction with no sailing, and an approved-space transaction):

```
F1  raw user id on page ......... false on ALL FOUR, and false on the PROVIDER view
F4  conversation link ........... present on all four
F5  procurement route ........... "Japan -> Harare, Zimbabwe"
F7  mobile 393px ................ page 393 vs 393, nav scrollable with affordance

F2  next step, per state:
      procurement + draft continuation  ACTION   "Continue shipping request"
                                                 "…a draft - review it and publish when you are ready."
      continuation (DRAFT)              ACTION   "Review and publish this shipping request"
                                                 "Providers cannot see it until you publish."
      logistics awarded, NO sailing     NONE     "Agree the shipping arrangement with your provider"
                                                 "…does not use a CarUp shared-container sailing…"
      logistics space APPROVED          NONE     "Container space approved"
                                                 "The later stages of the journey are not connected yet."

F3  "Continue shipping request" -> /diaspora/containers?view=mine&request=5d118a9f…
    draft reachable and still showing its inherited cargo: true
```

The APPROVED state deliberately offers **no** action: warehouse intake, loading, shipment, customs
and handoff have no authority yet, and inventing a button for them is exactly what the rest of this
programme refuses to do.

**Provider view:** no raw id, requester still withheld and labelled as such.

**Gates at closure:** backend **90/90** · real-Postgres T4 gate **11/11** · tsc clean · lint NET_NEW
**0/0** · build ✓ · 0 5xx, 0 unexpected 4xx.

> Console-error note, recorded because it was nearly reported as a defect: the UAT harness logged
> 16–24 `TypeError: Failed to fetch` entries. Idling 12s on the dashboard and 6s on a passport
> **without navigating** produces **zero**. Every one was the harness aborting in-flight requests by
> navigating immediately after sign-in. Not a product defect.

### Recorded non-blocking gap (owner-classified)

**A procurement-linked live logistics request cannot be cancelled or closed through the customer
product**, so the one-live-continuation slot cannot be intentionally released and a buyer cannot
arrange different shipping for that order. Nothing in the codebase writes `CANCELLED` or `CLOSED`
to a logistics request — T3 shipped no cancel capability. The partial index is correct and proven on
real Postgres; the missing piece is a **product action**, not a T4 convergence fault.

**Owner classification: NON-BLOCKING for T4. It must be implemented before production readiness.**
Placement belongs with logistics **request-lifecycle ownership** rather than being assigned blindly
to T5 or T7 — to be reconciled against the canonical roadmap when that lifecycle work is scheduled.

### Status

**T4-PARTIAL → T4-USABLE. T4 FROZEN at `736f06c5`.**

Blocking findings F1, F2, F3, F5 closed and verified on the deployed candidate; F4 and F7 closed in
the same bounded pass; F6 requires no product change. Production untouched. T5 not started.
PR #207 Draft.
