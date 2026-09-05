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
