# I9 — Mechanic vs Garage Projection Model (FROZEN)

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Frozen before** any I9 surface was built, per the moderator's instruction.

---

## 1. The distinction, preserved

CarUp already draws a line between the practitioner and the organization. I9 **projects along that line rather than redrawing it**.

| | Mechanic | Garage |
|---|---|---|
| Nature | a **person** / practitioner | a **tenant / organization** |
| Exists today as | formal platform role `mechanic` (in the `users.role` CHECK) | organization type `'garage'` and its tenant — **no user role** |
| Scope key | `mechanic_work_orders.mechanic_id`, `partsentry_logs.mechanic_id` | `mechanic_work_orders.tenant_id` / `organization_id`, `marketplace_inquiries.seller_tenant_id` |
| Answers | "is my practice growing, and what work is coming to me?" | "how is this business performing across everyone in it?" |

**No new top-level garage user role is created.** I9 needs garage *intelligence*, which is a projection concern; it does not need a new principal. Garage intelligence is reached by an authenticated member of the garage's tenant, exactly as dealer intelligence is — the tenant comes from verified session membership, never from a parameter.

**Shared data feeds both; neither impersonates the other.** A work order carries both `mechanic_id` and `tenant_id`. The mechanic projection filters on the person; the garage projection filters on the tenant. The same row can legitimately appear in both, because it is genuinely one practitioner's work *and* one organization's work — but a mechanic's figures must never be presented as the garage's, and a garage's must never be attributed to one mechanic.

Concretely, two rules the implementation enforces:

- a mechanic projection **never** widens to the tenant when `mechanic_id` is absent — an unattributed work order is excluded, not silently credited to whoever is looking;
- a garage projection **never** narrows to the caller — it is the whole tenant's work or it is refused, and it is refused when no verified tenant exists rather than falling back to the individual.

---

## 2. What CarUp can actually measure

Established by reading the live staging schema, not by assumption.

### Mechanic (person scope) — MEASURABLE

| Signal | Source | Note |
|---|---|---|
| Work orders received | `mechanic_work_orders` where `mechanic_id` = the practitioner | authoritative |
| Completion | `mechanic_work_orders.status` | authoritative state, no timestamp (see below) |
| Service records logged | `partsentry_logs` where `mechanic_id` = the practitioner | authoritative, append-only |
| Repeat customers | `mechanic_work_orders.customer_id`, distinct with ≥2 orders | authoritative |
| Demand by make/model | `mechanic_work_orders.vin` → `vehicles.make/model` | join, canonical vehicle identity |
| Enquiries | `marketplace_inquiries` of service type, seller-scoped | authority (I4 rule: the inquiry table is the lead count) |
| Response time | `message_threads.first_response_at` (Communications) | **reused, never recomputed** — Communications remains the authority |

### Garage (tenant/organization scope) — MEASURABLE

Everything above, re-scoped to `tenant_id` / `organization_id` / `seller_tenant_id`, plus:

| Signal | Source |
|---|---|
| Parts inventory held | `mechanic_parts` at `organization_id` / `tenant_id` |
| Practitioners contributing | distinct `mechanic_id` on the tenant's work orders |

### NOT MEASURABLE — declared, never invented

Each of these appears in the canonical plan's garage section. None has a source, so each is reported as not-yet-measurable **with the reason**, rather than estimated:

| Signal | Why not |
|---|---|
| **Bookings** | No booking, appointment or scheduling table exists **anywhere** in the schema. A work order is created after the fact; there is no record of a booking preceding it. |
| **Capacity / utilisation** | No service-bay, slot, shift or opening-hours model exists. |
| **Team / staffing performance** | `organization_branches` carries only `id, organization_id, name, location, phone` — no staff, no headcount, no assignment. |
| **Branch performance** | Work orders carry no branch reference, so work cannot be attributed to a branch. |
| **Turnaround time** | `mechanic_work_orders` has `created_at` only — **no completion, start or update timestamp**. Elapsed time to completion cannot be computed without inventing one. |
| **Cancellation rate** | No cancellation state or reason is recorded. |
| **Demand by service category** | There is no `service_type` column. `issue_description`/`description` are free text, and classifying free text into categories would be inference presented as measurement. |

Two of these are worth stating plainly because they are the plan's headline garage metrics: **booking conversion and capacity utilisation are not computable at all today.** Publishing either would require inventing the denominator.

---

## 3. Rules carried in

- **No fake zeros.** A failed or uncomputed read reports unavailable; only a genuinely measured zero renders as `0`.
- **Tenant isolation.** The garage projection resolves its tenant from verified session membership and refuses when there is none — the same `resolveOperatorTenantScope`-shaped rule applied in I5 and hardened in the G3 closure.
- **Canonical Truth/Trust.** Vehicle identity for make/model demand comes from `vehicles` via the VIN on the work order. No trust position is computed, displayed or implied by any service metric; a mechanic's activity says nothing about a vehicle's Trust.
- **Authority wins.** Enquiries come from `marketplace_inquiries`, response time from the Communications-stamped column. The activity ledger explains behaviour around those facts; it does not restate them.

---

## 4. Staging reality at freeze time

`mechanic_work_orders`: **0 rows**. One `garage_service_request` inquiry; one organization of type `garage`.

So the I9 surfaces will legitimately show zeros and unavailable states on staging today. That is the correct output for an empty dataset, and the surfaces distinguish it from a failed read — but it means I9 cannot be certified against controlled counts until work-order data exists. That is recorded as the phase's honest limitation rather than papered over with seeded demonstration data.

**This model is frozen.** I9 was implemented against it:

| Artefact | Path |
|---|---|
| Projection service | `backend/services/intelligence/serviceIntelligenceService.js` |
| Routes | `/api/mechanic/analytics` (person), `/api/garage/analytics` (tenant) |
| Surface | `web/src/components/intelligence/ServiceIntelligence.tsx`, mounted on the mechanic dashboard |
| Tests | `backend/tests/intelligence-service-mechanic-garage.test.js` (23), `web/src/components/intelligence/ServiceIntelligence.test.tsx` (12) |

### Separation, proven

- A mechanic sees only their own work — a colleague's orders in the same garage are excluded.
- An **unattributed** work order (no `mechanic_id`) is credited to nobody, yet still appears in the organization's figures, because it genuinely is the organization's work.
- A garage sees the whole tenant and does not change with who is looking — two colleagues get identical organization figures.
- A garage question with **no verified organization is refused**, not answered with the individual's own work.
- Another tenant's work never appears.
- Garage intelligence is reached by **tenant membership, not a garage role** — a `dealer`-role member of the garage tenant gets the organization view, and no new principal was created.
- The surface names the scope on screen ("Your own work only — not the whole garage" / "The whole organization"), so the two cannot be read as each other.

### Truth and Trust

A test serializes a service projection and asserts **no trust field of any kind appears**: a mechanic's activity says nothing about a vehicle's Trust. Vehicle identity for make/model demand comes from the canonical `vehicles` row via the work order's VIN; an unknown VIN counts as *unidentified* rather than being guessed, and the count of unmatched jobs is shown.

### Evidence

- Backend **4,562 tests / 0 failures**; web **110 files / 1,196 tests / 0 failures**; typecheck clean; build succeeds.
