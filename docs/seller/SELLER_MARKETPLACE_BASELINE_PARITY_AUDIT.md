# Seller ↔ Marketplace Baseline Parity Audit

**Authority:** `docs/seller/SELLER_UAT_REMEDIATION_EXECUTION_MASTER_PLAN.md`  
**Frozen baseline runtime:** `integration/vehicle-passport-v16-cert@106f76509ae1d1d10a3c4a26b4f93f7993d55027`  
**Reference VIN:** `CARUPGLDNA0000001` — 2019 Toyota Hilux, public Marketplace reference  
**Human UAT VIN:** `UAT20260828SELL01` — 2021 Toyota Hilux, USD 23,000, draft  
**Captured:** 2026-08-30  
**Purpose:** record the Phase B field/section truth before Seller redesign proceeds. This is a baseline audit, not evidence that the gaps are fixed.

## Source evidence used

Read-only exact-head requests against the paired staging backend:

- `GET /api/marketplace/listings/CARUPGLDNA0000001`
- `GET /api/vehicles/CARUPGLDNA0000001/passport`
- `GET /api/vehicles/UAT20260828SELL01/passport`

The public Marketplace endpoint reported 9 published listings at the same frozen baseline.

## Parity matrix

| # | Capability / section | Reference VIN state | UAT VIN state | Canonical source | Authority class | Expected missing state | UI component / surface | Gap | Severity | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| B2.1 | Listing gallery / cover / carousel | 5 published listing images; synthetic reference media; no explicit `is_primary=true`, first published image supplies summary image | `listing_media.state=none`; 0 items; no cover can propagate | `listing_media` / Marketplace presentation | Seller advertising media | Designed no-media state for draft; publication must not pretend media exists | Shared gallery / `ListingImage` / Vehicle Detail | Real Seller media never persisted, so preview/card/detail continuity cannot exist yet | P0 | No |
| B2.2 | Make / model / year / identity | 2019 Toyota Hilux, VIN `CARUPGLDNA0000001` | 2021 Toyota Hilux, VIN `UAT20260828SELL01` | Vehicle / Vehicle Passport | Canonical identity + Seller submission | Recorded / not recorded per field | Vehicle identity header / Passport | Core identity exists for both; dynamic Seller presentation parity still unproven | P1 | No |
| B2.3 | Price / currency | USD 21,500; source `operator_recorded` | USD 23,000; source `seller_declared` | Vehicle/listing pricing projection | Seller commercial statement + provenance | Price/currency not recorded separately | Commercial panel | Values exist; preview/public shared rendering and provenance semantics remain unproven | P1 | No |
| B2.4 | Mileage / fuel / transmission / drivetrain / body style / condition | 78,450 km; Diesel; Manual; 4WD in Passport; body style not recorded; condition unknown | 45,000 km; Diesel; Automatic; AWD; Pickup; Seller-stated condition `New` | Vehicle + Passport + Seller statements | Mixed canonical/spec + Seller statement | Truthful per-field missing state | Specification panel | UAT has richer Seller data but shared preview/public projection is not certified; `new to CarUp` must remain separate from commercial `New` | P1 | No |
| B2.5 | Seller description / features | No Seller description/features recorded | Description present; features ABS, AC, Towbar | Listing Seller statements | Seller-stated | Not recorded | Seller description/features | UAT content must survive draft resume and appear in Buyer Preview/public mode without becoming canonical fact | P1 | No |
| B2.6 | Seller identity / seller type | Private Seller; display label not recorded; public profile disabled | Private Owner; display label `CarUp UAT Seller 29A`; public display enabled | Governed Seller claims/profile | Seller identity + privacy projection | Withheld/not recorded | Seller summary / contact region | Cross-surface projection and business/dealer semantics not yet certified | P1 | Phase D only if policy ambiguity remains |
| B2.7 | Location / privacy projection | Bulawayo / Bulawayo Metropolitan / Zimbabwe, recorded | Harare / Harare Metropolitan; country not recorded | Governed location claims | Seller statement + privacy projection | Province-only / city withheld / not recorded | Seller/location summary | Must prove selected disclosure does not leak city/address/contact beyond policy | P0 | No |
| B2.8 | Canonical Trust | Evaluated: 60, moderate, low confidence, version `trust-decision-1.0.0` | `not_evaluated`; score/band null; legacy unversioned stored score explicitly not published | Canonical Trust decision authority | Computed/governed | `Not evaluated` | Trust summary | UAT UI must never substitute legacy 60/100 or listing completeness/readiness for Trust | P0 | No |
| B2.9 | Trust confidence / source coverage | Low confidence; 0 connected sources; explicit known limitations | Not evaluated; no canonical evidence basis | Trust decision authority | Computed/governed | Not evaluated / source not connected | Trust/source coverage | Needs explicit designed state distinct from completeness and publication readiness | P1 | No |
| B2.10 | Government / partner checks | No live source connected; limitations explicitly say government/partner results unavailable | Not evaluated / no connected source proof | Governed external-source layer | Governed external source | Source not connected / not evaluated | Verification/source panel | Must render absence honestly; no fake pass from stored legacy flags | P0 | No |
| B2.11 | Registration / plate / identifier state | Registration country Zimbabwe; authority/status/plate not recorded in reference claims; identity remains VIN-based | Registration country/authority/status/plate not recorded; identifiers redacted | Passport identity / registration claims | Governed identity | Not recorded / redacted | Registration/identity section | Dynamic missing-state parity not yet proven | P1 | No |
| B2.12 | Evidence state | 4 verified public-safe evidence records: registration, police clearance, inspection photo, insurance; files themselves withheld/private | No verified evidence; evidence timeline empty | Evidence authority + Passport projection | Governed evidence | None / pending / verified / rejected | Evidence/registration section | UAT Seller upload → pending → independent review → public projection not UI-certified | P0 | No |
| B2.13 | Lifecycle / history | Current-condition event, ownership transfer, 4 verified evidence events, PartSentry repair summary | Current-condition event + ownership transfer; no evidence/service history | Vehicle Passport lifecycle projection | Governed lifecycle | Partial / none with source state | Lifecycle section | Same information architecture must remain present in draft preview/public detail regardless of sparse history | P1 | No |
| B2.14 | Ownership | Current Seller recorded but hidden publicly; previous owner count 1; names redacted | Current Seller recorded/visible per Seller setting; previous owner count 1; names redacted | Ownership ledger / Passport | Governed/private | Redacted/private | Ownership section | Privacy and sold-state persistence need end-to-end proof | P0 | No |
| B2.15 | Service | 0 service records, state partial; mechanic work-order source unavailable | 0 service records, state partial; mechanic work-order source unavailable | Passport/service sources | Governed | Partial / source unavailable | Service section | Sparse source state must be preserved, not dropped or shown as verified zero | P1 | No |
| B2.16 | PartSentry | Source available; 1 repair/maintenance summary, unverified | Source available; no substantive PartSentry records | PartSentry + Passport projection | Governed | None / summary-only / verified where applicable | PartSentry section | Dynamic section parity and truthful empty state not yet proven | P1 | No |
| B2.17 | Insurance | One verified evidence document exists, but insurance registry source is unavailable; lifecycle count state partial | No insurance evidence; registry source unavailable; lifecycle state partial | Evidence + insurance registry source | Governed | Evidence-only / source unavailable / partial | Insurance section | Must distinguish uploaded evidence from live insurer/registry verification | P1 | No |
| B2.18 | Pricing / cost estimate | Deterministic estimate: fair range USD 18,920–24,080; estimated total USD 22,373; low confidence | Draft public cost projection not available through the same Buyer presentation yet | Marketplace pricing summary | Computed estimate | Unavailable / low confidence | Pricing/cost panel | Seller Buyer Preview and public detail do not yet share proven pricing architecture | P1 | No |
| B2.19 | Inquiry | Public listing is eligible for governed inquiry flow | Draft must not accept public inquiry | Marketplace inquiry authority | Governed buyer intent | Unavailable before publication | Inquiry region | Public-only behavior exists in reference; mode-specific continuity into Seller Communications is unproven | P0 | No |
| B2.20 | Reservation / SafePay readiness | Reservation none; transaction intent `inquiry_only`; escrow required; deposit not allowed | Draft/non-public; no buyer transaction state should be active | Marketplace transaction/reservation authority | Governed | Not available / inquiry only | Transaction region | Draft preview must not expose active buyer transaction controls; public mode must remain governed | P1 | No |
| B2.21 | Save | Supported for public Marketplace listing | Must be disabled/unavailable in non-public Seller preview | Marketplace buyer action | Buyer action | Unavailable in preview | Save control | Shared mode behavior needs proof | P1 | No |
| B2.22 | Compare | Supported for public Marketplace listing | Must be disabled/unavailable in non-public Seller preview | Marketplace buyer action | Buyer action | Unavailable in preview | Compare control | Shared mode behavior needs proof | P1 | No |
| B2.23 | Share | Supported for public listing | Preview sharing semantics must clearly remain non-public or disabled | Marketplace/public action | Buyer/public action | Limited/non-public | Share control | Current draft preview semantics are not proven | P1 | No |
| B2.24 | Recommendations / related vehicles | Public reference participates in Marketplace recommendation/discovery ecosystem | Draft must not participate in public recommendations | Marketplace/Home public inventory | Governed public inventory | None while draft | Recommendations / Home live inventory | Automated/test inventory contamination previously distorted this downstream surface | P0 | No |
| B2.25 | Publication state | `published` / public | `draft` / non-public | Publication policy | Governed lifecycle | Draft / blocked / ready | Seller publication + Marketplace projection | Core UAT specimen is correctly private; complete readiness UI and publish/unpublish/republish/sold lifecycle remain unproven | P0 | No |
| B2.26 | Missing / pending / unavailable design state | Reference demonstrates evaluated, low-confidence, partial, unavailable and withheld states in one architecture | UAT requires no-media, no-evidence, not-evaluated Trust, partial lifecycle and unavailable sources | Shared presentation state model | Mixed governed/computed/private | Designed truthful state, never fake zero/pass | Shared Buyer Preview/Public Vehicle Detail | Draft currently lacks proven one-architecture parity; this is the main convergence gap | P0 | No |

## Phase B conclusions

1. The UAT vehicle is not missing its identity or commercial data; the critical gap is **projection and continuity**, especially media and the shared Buyer presentation.
2. `UAT20260828SELL01` is correctly non-public at the frozen baseline.
3. Canonical Trust behavior for the UAT specimen is correct at the API projection level: **not evaluated**. Any visible legacy 60/100 would therefore be a UI regression, not canonical truth.
4. The reference demonstrates why “0” and “unavailable” cannot be conflated: service/insurance registry sources can be unavailable while evidence/lifecycle summaries still exist.
5. Listing media and verified evidence are separate authorities and must remain separate throughout remediation.
6. The reference public architecture already exposes pricing, Trust limitations, transaction intent, evidence, lifecycle and privacy states. A fresh Seller vehicle must use this same information architecture even when its values are sparse.
7. Phase B1 visual evidence remains a separate gate. This parity audit does not substitute API truth for required screenshots.

## Baseline gate status

- B2.1–B2.26: audited.
- B2.27: this committed audit is the repository artifact.
- B1.1–B1.13: pending exact-head desktop/tablet/mobile visual capture.
- Phase B roll call: remains open until B1 is complete.

