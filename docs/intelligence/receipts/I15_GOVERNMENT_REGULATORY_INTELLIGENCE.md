# I15 — Government / Regulatory Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I15
**Status:** implementation and tests complete; institutional certification carried to I19 (no authoritative provider is connected)

---

## 1. The constraint, and what the data says

The plan gives this phase one hard rule: **no government "verified" status may be
invented.** Everything below follows from taking that literally.

| Source | Rows | What it means |
|---|---|---|
| `provider_registry` | **0** | no CVR, ZIMRA, ZINARA, CID or VID integration is registered at all |
| `source_verification_results` | 3 | **all** `zimra` / `sandbox` / `match` |
| `registry_verifications` | 2 | rows with a `checked_by` — CarUp staff notes, not registry responses |
| `vehicle_evidence` | 20 | 19 review-complete, 1 pending — CarUp's own review |
| `verification_decisions` | 19 | 11 resubmission, 4 escalate, 3 reject, **0 approve** |
| `trust_audit_events` / `organization_audit_logs` | 5039 / 83 | a real audit trail exists |

So the central distinction this phase exists to hold is:

- **CarUp assessed** — CarUp reviewed documents a user supplied. This exists.
- **Registry confirmed** — an authoritative government source said so. **This does
  not exist anywhere in CarUp today.**

The projection names every assessed field `carup_assessed_*` so the same row can
never be read as a government determination, and a test forbids any assessment
field being named `verified_vehicles`, `government`, `official` or
`registry_verified`. A sandbox check is reported in its own block with no combined
total for it to be added into: a sandbox match is a simulator agreeing with itself.

An institutional role also remains **not a super-admin** — `commercial_behaviour_access`
is `false` in the payload and a test asserts no commercial field (listings,
inquiries, sellers, views, price, revenue) appears anywhere in it. That is the G5
boundary, restated in the data so it travels with it.

---

## 2. The fabrications removed — `GovernmentDashboard.tsx`

This was the worst surface the programme has found. **Nothing on the page except
the duty estimator talked to a server.**

| Removed | Was |
|---|---|
| Four headline tiles | `'1.2M'` registered vehicles, `'234'` pending verifications, `'89'` verified today, `'3 Active'` security alerts — all string literals. CarUp is not a national registry and holds none of this. |
| Monthly registrations chart | a fixed five-month array rendered as national volumes |
| "Secure Hardware Session Audits (MFA)" | **invented officers named** — "Inspector T. Chihuri", "ZIMRA Desk Officer Moyo" — with invented IP addresses and timestamps, presented as a regulatory authentication log. CarUp holds no officer directory and issues no officer credentials. |
| Access-control banner | "Secure RBAC isolation is **fully enforced**", naming a bank as a restricted party, with no check behind it |
| Seeded duty result | `totalDuty: 10125`, `vat: 1500`, `percentageOfValue: 101.25`, `surtax: 3500` in component state, rendered on load as though it were a ZIMRA assessment of the pre-filled inputs |

### The seed was hiding a real defect

The API returns VAT under **`breakdown.vat`**, not at the top level. The component
read `dutyResult.vat.toLocaleString()`. So the first *genuine* calculation would
have set that field to `undefined` and thrown a `TypeError` mid-render — the page
only appeared to work because the fabricated seed happened to carry the field.
A web test now pins the real response shape.

The estimator itself is real (a local calculation: 40% duty, 15% VAT, 35% surtax
over five years) and is kept. It is relabelled from "ZIMRA Dynamic Custom Duty
Estimator" to an import duty **estimate**, with a note placed *before* the inputs
saying CarUp is not connected to any revenue authority and the figure is not an
assessment, a ruling, or an amount anybody owes.

## 3. `ComplianceReports.tsx`

- **A download that never happened.** The handler resolved a two-second timer and
  then announced `"{report} downloaded successfully!"`. No request was made, no
  file written. It now opens the report's actual `url`, and the button reads "No
  file" and is disabled when there is none.
- **A failed read rendered as zero.** All four tiles showed 0 and the list said
  "No compliance reports found" behind a toast that vanished. Now distinguished.
- **A mislabelled rate.** "Compliance Rate" was the share of *this list* that had
  been generated — nothing to do with whether anybody is compliant. Renamed
  "Generated share", and it reads "No reports" rather than `0%` on an empty list.

---

## 4. Files

**New:** `backend/services/intelligence/governmentIntelligenceService.js`,
`backend/tests/intelligence-government.test.js`,
`web/src/components/intelligence/GovernmentIntelligence.tsx`,
`web/src/components/intelligence/GovernmentIntelligence.test.tsx`,
`web/src/pages/dashboard/government/GovernmentDashboard.test.tsx` (first coverage)

**Modified:** `backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/government/provenance-intelligence`, `['government','admin']`),
`web/src/hooks/useCarUpApi.ts`, `web/src/types/index.ts` (`ComplianceReport.url`),
`web/src/pages/dashboard/government/GovernmentDashboard.tsx`,
`web/src/pages/dashboard/government/ComplianceReports.tsx`

`GovernmentIntelligence` is **mounted** on the institutional portal, and its
"no authoritative source is connected" banner is rendered *before* any figure.

**Migrations: none.**

---

## 5. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4691 tests, 0 fail**, 21 skipped |
| Web suite | **1260 tests, 117 files, 0 fail** |
| I15 backend tests | 20 pass |
| I15 web tests | 8 (component) + 6 (dashboard) pass |
| Web typecheck / build | clean |

One test-authoring fault of my own, fixed rather than worked around: a regex
expecting "not a government verification" against text reading "Nothing here **is**
a government verification".

---

## 6. Noted, not changed

`simulateZimraClearance` in `backend/services/import/importService.js` returns a
hardcoded `zimraAuthorizedBy: 'ZIMRA_OFFICER_CHIKOMBA_920'` and a
`CLEARED_DUTY_PAID` status. It is **dead code** — nothing in the backend or the web
app calls it — and its name is honest about being a simulation, so it is recorded
here rather than changed. It should not be wired to any live path without a real
provider behind it.

---

## 7. Carried to I19

No authoritative institutional integration exists to certify against, so
registry-confirmed provenance cannot be exercised end to end. Joins I9, I10, I11,
I12, I13 and I14.

**Production boundary respected:** source and staging only.

**Next:** I16 — CarUp Automotive Intelligence Command Center.
