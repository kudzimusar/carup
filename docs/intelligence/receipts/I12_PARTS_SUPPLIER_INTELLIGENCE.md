# I12 — Parts & Supplier Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I12
**Status:** implementation and tests complete; controlled-count certification carried to I19 (2 provenance rows, 0 stock rows)

---

## 1. What the live data actually says

The plan asks for parts demand, zero-result demand, compatibility, RFQ, supplier
performance and the PartSentry/provenance relationship. Reading staging first
settles which of those CarUp can answer, and it is fewer than the list.

| Source | Rows | What it means |
|---|---|---|
| `marketplace_inquiries` `inquiry_type='part_quote_request'` | 5 | 3 `new`, 2 `contacted` |
| `partsentry_logs` | 2 | 1 verified + flagged + publicly eligible; 1 unverified |
| `mechanic_parts` | 0 | tenant-scoped garage stock |
| `partsentry_review_requests` | 0 | — |
| parts catalogue / fitment table | **does not exist** | no such table anywhere |
| supplier registry | **does not exist** | no table, no login role |

**The decisive finding.** All five part RFQs have a NULL `seller_id`, a NULL
`seller_tenant_id`, a NULL `listing_id` and empty `metadata`. They carry only a
status and a source channel.

So an RFQ records that *somebody asked for a part* — not **which** part, and not
**who was asked**. That single fact removes four of the six requested deliverables:

- **demand by part** — no part reference was ever recorded, only free text;
- **supplier attribution** — no request names a supplier, so no supplier has a queue;
- **supplier performance** — follows from the above, and there is no supplier
  principal to measure anyway. `mechanic_parts.supplier` is free text a garage
  typed about its own purchasing, not a platform party;
- **compatibility** — there is no catalogue and no part↔vehicle fitment table, so a
  fitment claim would be invented outright. A wrong one puts the wrong component
  on a car, which is why this is refused rather than approximated.

**Zero-result demand** is also refused. The activity ledger's
`marketplace_search_zero_results` covers the **vehicle** marketplace. CarUp has no
parts search at all, so counting those as unmet parts demand would attribute
vehicle searches to parts.

What is real and is served: RFQ volume and its status funnel (platform scope),
PartSentry provenance, and a garage's own stock.

---

## 2. The fabrications removed — `PartsTracking.tsx`

This page had **no test coverage at all**, which is how four separate assertions
survived in it.

| Removed | Was |
|---|---|
| Fake-empty on failure | the `.catch` only raised a toast, leaving `parts` empty — so all four tiles read 0 and the table said "No parts found. Add a new part to your inventory." An outage was indistinguishable from an empty shelf. This is the systemic defect I0 flagged on ~12 surfaces. |
| Invented supplier | `supplier: d.supplier \|\| 'Internal'` — a missing value asserted as a sourcing fact |
| Invented reorder level | `minStock: d.min_stock ?? 5` — a threshold nobody set, which then **drove the Low Stock tile and the amber row badge**. A garage was being alerted against a number CarUp made up. |
| Zero-coercion | `stock ?? 0` fed the Out of Stock count; `price ?? 0` silently understated the inventory value |
| Mangled identity | `id: d.id.substring(0,8).toUpperCase()`, with `Math.random()` as a fallback id |

**And the worst of them.** The "Upload Invoice" control's handler was, in full,
`toast.success('Invoice uploaded for {part}!')`. No request was made, no file was
stored, and there is no parts-invoice endpoint to store it. It told a garage its
document was filed while discarding it. That is not a bad number — it is a false
confirmation of a persistence action, so the control is **removed** rather than
relabelled.

**Replacements are honest, not blank:** an unrecorded value reads "Not recorded";
the Low Stock tile reads "No reorder level set" when no threshold exists; and the
inventory value states its coverage ("Covers 1 of 2 parts. The true total is
higher.") rather than summing unpriced parts as zero.

---

## 3. What was built

`backend/services/intelligence/partsIntelligenceService.js` — `parts_demand@1`.

**Two scopes, and the I9 freeze is preserved exactly.** A PartSentry record belongs
to a **person** (`mechanic_id`); a stock list belongs to an **organization**
(`tenant_id`). Neither answers for the other, and a practitioner with no
organization is told stock is an organization question rather than shown a zero.

- `getMechanicPartsIntelligence` — own provenance + own organization's stock.
- `getPlatformPartsIntelligence` — RFQ demand + provenance, platform admin only.

**RFQ demand lives only at platform scope.** With no seller on any request there is
no supplier scope to filter to, and handing the platform-wide figure to one party
would present everybody's demand as theirs. A practitioner call returns no
`rfq_demand` block at all.

**Provenance is not a fraud verdict.** `public_card_eligible` is *read* from the
governed gate rather than recomputed, and `suspicion_status` is counted as
"flagged for review" — the one flagged log on staging is also a **verified** one,
so flagging must not subtract from verification. Fraud adjudication stays a
separate governed domain, stated in the payload's `domain_boundary`.

### A fake-zero found in my own code

The first `buildInventory` used `Number.isFinite(Number(v))` to decide whether a
value was recorded. `Number(null)` is **0** and `Number('')` is **0**, so a part
with no stock level was read as a genuine zero and counted as out of stock, and a
part with no threshold was given a threshold of 0.

Three tests caught it before it shipped. Replaced with a `recorded()` helper that
returns null for null/undefined/empty. This is the precise defect the phase exists
to remove, reproduced in the tool built to remove it — worth recording.

---

## 4. Files

**New:** `backend/services/intelligence/partsIntelligenceService.js`,
`backend/tests/intelligence-parts.test.js`,
`web/src/components/intelligence/PartsIntelligence.tsx`,
`web/src/components/intelligence/PartsIntelligence.test.tsx`,
`web/src/pages/dashboard/mechanic/PartsTracking.test.tsx` (first coverage for that page)

**Modified:** `backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/parts/intelligence` → `['mechanic','admin']`;
`GET /api/admin/parts/intelligence` → `['admin']`, deliberately **not**
`government`, so gap G5 is not repeated on a parts surface),
`web/src/hooks/useCarUpApi.ts`, `web/src/pages/dashboard/mechanic/PartsTracking.tsx`

`PartsIntelligence` is **mounted** on the mechanic parts surface, not left as an
unreferenced component.

**Migrations: none.** I12 adds no schema. Its findings are absences.

---

## 5. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4628 tests, 0 fail**, 21 skipped |
| Web suite | **1227 tests, 113 files, 0 fail** |
| I12 backend tests | 22 pass |
| I12 web tests | 10 (component) + 9 (PartsTracking) pass |
| Web typecheck | clean |
| Web build | clean |

---

## 6. Carried to I19

- **2 PartSentry rows and 0 stock rows** on staging, so provenance and inventory
  cannot be certified against meaningful counts. Joins I9 (0 work orders), I10 (no
  live insurer) and I11 (no lender onboarded).
- No demonstration parts, suppliers or RFQs were seeded to close this.
- **Noted, not fixed here:** `PartSentry.tsx` writes `'UNKNOWN'` for a missing OEM
  and `'Service performed'` for a missing description on submission. The second
  fabricates a record's content from an empty field. It is a write path on an
  owner surface rather than an intelligence surface, so it is recorded for
  disposition rather than changed in this phase.

**Production boundary respected:** source and staging only. No production
migration, promotion, integration or activation.

**Next:** I13 — Diaspora / Trade Intelligence.
