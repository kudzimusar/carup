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

### BLOCKED: procurement-origin staging journey

The staging migration was **not applied** — `apply_migration` was refused by the environment's
safety classifier, and subsequent staging SQL reads were refused too. I did not re-route the same
DDL through another tool, because that would work around the intent of the refusal rather than the
mechanism.

Consequence, stated precisely: `diaspora_logistics_requests.import_order_id` does not exist on
staging, so **the procurement-origin passport and the continuation cannot be exercised there**. The
logistics-origin passport is unaffected and is certified above — it reads the column only for the
optional `continued_from_order`, which is absent and correctly renders as none.

Both are fully covered by the service tests and by the real-Postgres constraint gate. What is
missing is deployed-staging evidence for those two paths, and it needs one authorized action:
apply `20260906090000_trade_os_t4_transaction_continuation_link.sql` to staging.

## 6. Known limitations and deferred work

- **Procurement-origin + continuation not certified on deployed staging** — blocked above.
- **Documents for a pure logistics-origin transaction** have no anchor; `diaspora_trade_documents`
  keys on `import_order_id` only. The passport says so rather than inventing one. Owner: **T8**.
- **No shipment path for logistics-origin** — `diaspora_shipments` anchors on `import_order_id`.
  Owner: **T11**.
- **The legacy `DiasporaOrderPassport` remains** as the compliance record (government footprint,
  audit, payment milestones, ownership handoff). The two surfaces now link to each other so neither
  is orphaned; absorbing those sections belongs with T8/T12/T13.
- **Intelligence pairing is event-level only.** T4 emits no new event types; the existing
  `diaspora.rfq.*`, `diaspora.logistics.*` and `diaspora.container_booking.*` already carry award,
  request and approval. No dashboards were built (T15).

## 7. Status

**T4-PARTIAL.** Implementation complete and certified everywhere it can be, but the
procurement-origin journey lacks deployed-staging evidence until the migration is applied.

**Owner UAT required: YES.** T3 remains frozen and green. Production untouched. T5 not started.
PR #207 stays Draft.
