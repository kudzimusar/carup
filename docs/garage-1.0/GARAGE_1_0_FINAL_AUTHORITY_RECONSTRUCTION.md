# GARAGE-1.0 FINAL — Phase A: authority reconstruction

Accepted starting authority: OPS03 `07b60e5d158d7dad7232d33f11f06a478c92da3f` (PR #241, Draft, unmerged).
Reconstruction method: read-only source inspection of that exact commit, plus read-only queries of the
staging database (`eoyenigwevnxwwhyhaer`) for live shape. Production was not accessed.

Classification vocabulary: **EXISTS — REUSE** · **EXISTS BUT NOT GARAGE-CONVERGED** · **MISSING — BUILD** ·
**EXTERNAL — INTEGRATE ONLY IF A CANONICAL CONTRACT EXISTS** · **DEFER (real external blocker)**.

| Capability | Existing authority found | Verdict | What this campaign did |
|---|---|---|---|
| Work orders | `mechanic_work_orders` (006 + convergence + OC-5A + S4): one per Service Case (partial unique), `status` text with no DB CHECK, `owner_authorization` CHECKed | EXISTS — REUSE | No second work-order table. Added only a composite-FK index `(id, tenant_id)` and DB guards. |
| Customer authorization | `owner_authorization` + `mechanic_work_order_decide_authorization()` (service_role only; owner basis re-proven against `vehicles.owner_id`; `revoked` is final) | EXISTS — REUSE | Estimate acceptance **calls** this function in the same transaction. No `estimate_authorized` / `customer_approved` flag exists anywhere. |
| "Start work" gate | **Absent.** Only `recordService` and PartSentry checked authorization; `startServiceCase` and the queue's `next_action` ignored it | MISSING — BUILD (gate only) | OPS05 DB triggers: a case cannot become `active` unless its job is authorized, open and has a live mechanic. |
| Assignment | `work_order_assignments` (one live per work order); `assignMechanic` swallowed a failed legacy-column mirror | EXISTS — REUSE (defect fixed) | Mirror failure now undoes the assignment and reports the real conflict. |
| Service records / mileage | `service_records`, `service_mileage_observations`, `service_record_parts`; "only completed work" was **not** a rule | EXISTS — REUSE | OPS05: records only on an authorized, started, open job; a job completes only with recorded work. Estimate lines are never copied into history. |
| Service Case | `service_cases` + append-only `service_case_events`; JS-only, non-atomic transitions | EXISTS — REUSE | `complete_job` completes job + case + history in one transaction; start/completion guards in the database. |
| Appointments / capacity / sites / workforce / CRM | OPS01–OPS03 | EXISTS — REUSE (frozen) | Consumed, not changed. Customer notifications for appointment decisions added. |
| Estimates / quotations | **None for Garage.** Trade OS / Diaspora quotes are logistics/import objects; `NO_ESTIMATE_MODEL` was a pinned truth | MISSING — BUILD | OPS04: `garage_estimates`, lines, events. Versioned, immutable once sent, DB-derived totals, explicit currency. |
| Parts master | `mechanic_parts` (staging: shape A, 0 rows; no `(tenant, sku)` unique, no currency, `stock_level` default 0, `min_stock` default 0) | EXISTS BUT NOT GARAGE-CONVERGED | OPS06 extends it additively (CV01 forbids a second master); unrecorded stays NULL. |
| Stock movement ledger | Only Diaspora's (`diaspora_stock_ledger`, USD-defaulted, import-specific) | MISSING — BUILD | OPS06 `garage_stock_movements`: append-only, arithmetic CHECK, idempotency keys, total order. Diaspora's ledger mirrored only as a mechanic, not reused. |
| Parts used on a job | `service_record_parts` links PartSentry logs only (no quantity/cost) | EXISTS BUT NOT GARAGE-CONVERGED | `garage_service_part_usage` (snapshots, reversal) + the existing PartSentry link written too. |
| PartSentry | `partsentry_logs` + attestation + `partsentry_record_service` | EXISTS — REUSE (provenance only) | Optional validated reference from a usage row; PartSentry stays the provenance authority. |
| Supplier / procurement | Free text on `mechanic_parts.supplier`; no registry, no purchasing | EXTERNAL | Supplier remains free text exactly as stated. No verified-supplier, rating, SLA or purchase-order claim is made anywhere. |
| Invoice | **None.** (`repair_invoice` is only an evidence document subtype) | MISSING — BUILD | OPS07 `garage_invoices` (+ lines, events): document/obligation, never proof of payment. |
| Payment | Marketplace escrow, SafeTrade, Diaspora milestones/billing, legacy SafePay (retired) — none can represent a Garage service payment | EXTERNAL / DOMAIN INTEGRATION | Not force-fitted. OPS07 `garage_payment_records` are explicitly `garage_recorded_external`. Live settlement is an external gate (see matrix). |
| Receipt | None | MISSING — BUILD | OPS07 `garage_receipts`: cannot exist without a matching payment record (trigger). |
| Communications | Outbox → policy → governed template → in-app queue; users, not tenants, are addressed | EXISTS — REUSE | One governed in-app template; seven customer-facing events; dedupe once per (entity, recipient). No Garage sender/queue/table. |
| Analytics | `serviceIntelligenceService`, `serviceMetricCatalogue` (capacity/staffing/estimate/no-show pinned "not measurable") | EXISTS BUT NOT GARAGE-CONVERGED | New read-only operations view over OPS01–07 records; catalogue reclassified truthfully. |
| Vehicle history / Passport | `buildCanonicalVehicleLifecycle` already projects `service_records` (never `work_performed`); work orders reach it only for privileged audiences | EXISTS — REUSE | Verified by test: a completed job appears; a declined job and every amount do not. |
| Audit | `trust_audit_events`; per-domain append-only event tables | EXISTS — REUSE | Every new transition writes its own event row **and** a `trust_audit_events` row in the same transaction. |
| Money conventions | Shape-only `^[A-Z]{3}$` checks, NUMERIC, many `DEFAULT 'USD'` | EXISTS BUT NOT GARAGE-CONVERGED | `garage_ops04_currency_scale()` (SQL) + `garageMoney.js` (ICU-validated, mirrored): explicit currency, exact decimals, no default anywhere. |

## Inherited facts recorded rather than hidden

* Twenty backend tests (C1 FX observer, D OCR provenance) fail **identically** on the accepted `15b087` baseline
  and on OPS03 `07b60e5d` (CI run for PR #241): inherited, not Garage, not caused by this campaign.
* The accepted OPS03 head left two latent web design-gate failures (an undeclared surface and nine controls below the
  44 px floor). OPS03's own CI runs a focused file list so it never saw them. Fixed in `fc28c490` without weakening the gate.
* Staging at campaign start: backend `dpl_GTRNcuTikKL6u2MV7meiKdK9BwJK` and web `dpl_7AQTQs1apayK5PrVUk3RDai88Dut`, both built from
  `07b60e5d`; staging migration tip `garage_ops03_appointments_scheduling_capacity`; OPS01 baseline intact
  (3 active sites / 1 primary, 10 mechanic memberships, 10 active workforce, 10 live primary assignments, 4 active departments, Owner workforce 0).
