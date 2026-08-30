# Seller ↔ Marketplace Parity Matrix

**Execution authority:** `docs/seller/SELLER_UAT_CONVERGENCE_REMEDIATION_EXECUTION_PLAN.md`  
**Baseline head:** `200c08b4599952cb35ce7d63538380249b91d1e9`  
**Human UAT vehicle:** `UAT20260828SELL01` — 2021 Toyota Hilux, USD 23,000, draft  
**Reference comparison:** current rich public Marketplace vehicle(s), plus the live Marketplace presentation contract  
**Status:** living audit; update after every relevant implementation task

| Capability / section | Reference/public source | UAT20260828SELL01 current state | Authority class | Expected missing state | Current gap | Severity |
|---|---|---|---|---|---|---|
| Gallery | `listing_images` / Marketplace listing media | No canonical listing media persisted | Seller advertising media | Designed no-media / delivery-error distinction | Seller upload selection did not persist; cross-surface gallery absent | P0 |
| Primary/cover image | seller-selected listing media | None | Seller advertising media | Designed missing media | Cover cannot propagate without persisted media | P0 |
| Make/model/year/VIN | vehicle/Passport | Toyota Hilux 2021 / VIN recorded | Canonical identity + seller submission | Recorded | Present | — |
| Price/currency | vehicle/listing | USD 23,000 | Seller commercial statement | Not recorded | Present | — |
| Mileage/spec | vehicle/listing | 45,000 km; Diesel; Automatic; AWD | Seller statement/canonical vehicle projection | Not recorded | Present | — |
| Seller-stated condition | vehicle/listing | New | Seller statement | Not recorded | Must not be confused with “new to CarUp” intent | P1 |
| Description/features | vehicle/listing | Present | Seller statement | Not recorded | Must persist through resume and Buyer Preview | P1 |
| Seller display/privacy | claims seller | public display enabled; label recorded | Seller privacy statement | withheld/private | Cross-surface projection needs explicit acceptance | P1 |
| Location/privacy | governed location claims | Harare / Harare Metropolitan | Seller statement + privacy projection | not recorded / province-only/etc | Must prove no private leakage | P1 |
| Canonical Trust | Trust decision authority | Not evaluated; legacy value intentionally unpublished | Computed/governed | Not evaluated | UI must not substitute 60/legacy score | P0 |
| Trust confidence/source coverage | Trust decision authority | Not evaluated | Computed/governed | Not evaluated/source not connected | Must remain distinct from completeness/readiness | P1 |
| Listing completeness | Seller readiness model | Incomplete because media absent | Seller/computed readiness | incomplete/not tracked | Needs explicit UI separate from Trust | P1 |
| Publication readiness | publication gate | Draft, blocked until governed requirements met | Governed policy | exact blocker list | Needs dedicated final-stage presentation | P1 |
| Evidence/registration | evidence + Passport | no verified public evidence currently | Governed evidence | none/pending | Seller upload/review path needs UI certification | P1 |
| Government/partner checks | source coverage | not connected/not evaluated | Governed external source | source not connected | Must render designed states, never fake pass | P1 |
| Cost/pricing context | Marketplace pricing summary | draft preview path incomplete | Computed estimate | unavailable/low confidence | Needs shared preview/public presentation | P1 |
| Lifecycle/history | Passport lifecycle | ownership transfer + current condition known | Governed lifecycle | partial | Must remain visible in preview/public shared architecture | P1 |
| Ownership | ownership ledger | current Seller relationship recorded | Governed | private/redacted | Must persist through sold state | P1 |
| Service | Passport/service sources | partial/unavailable | Governed | source unavailable/partial | Needs parity section | P2 |
| PartSentry | Passport/PartSentry | available source but no substantive records | Governed | none/partial | Needs parity section | P2 |
| Insurance | insurance source | unavailable | Governed | source unavailable | Needs parity section | P2 |
| Reservation/SafePay | Marketplace transaction state | none / draft non-public | Governed | not available | Needs parity section and public-only buyer action | P2 |
| Save | Marketplace buyer action | draft must not expose | Buyer action | unavailable in preview | Must prove public path only | P1 |
| Compare | Marketplace buyer action | draft must not expose | Buyer action | unavailable in preview | Must prove public path only | P1 |
| Share | Marketplace buyer action | draft preview semantics unclear | Buyer/public action | limited/non-public | Must prove mode-specific behavior | P1 |
| Recommendations | Marketplace/Home | current inventory polluted by automation fixtures | Governed public inventory | none | Test contamination affects recommendations | P0 |
| Inquiry | Marketplace governed inquiry | draft must not accept public inquiry | Governed buyer intent | unavailable before publish | Public path works; UI continuity to Seller must be proven | P1 |
| Communications linkage | Communications projection | Seller inquiry card exists; thread projection not proven | Governed communications | provider disabled vs in-app distinct | Golden test weakened this gate | P0 |
| Intelligence | activity ledger/rollup | UI may say unavailable; event propagation not proven | Governed analytics | precise source unavailable | Golden test weakened this gate | P0 |
| Home live hero | newest public inventory currently | human draft correctly excluded | Public inventory presentation | bounded missing-media state | automated 1×1 fixtures can become hero | P0 |
| Eight useful next moves | Home conceptual/media system | affected by live inventory media failure | Mixed conceptual + listing media | conceptual fallback | Concept scenes depend too much on public listing media | P1 |
| Owner Dashboard | legacy owner surface | old card/dashboard visual language | Governed workspace UI | truthful data states | Major visual/design convergence missing | P1 |
| My Garage | owner workspace | draft vehicle visible | Governed workspace UI | truthful missing media | Legacy layout; Continue listing hierarchy incomplete | P1 |
| Evidence Vault nav | feature registry/navigation | shares route with My Garage | Navigation contract | distinct route/intent | double-active architecture defect | P0 |
| My Listings | seller operating surface | draft visible | Governed workspace UI | truthful states | Legacy management design; action hierarchy incomplete | P1 |
| Seller Studio | SellVehicle | functional but visually legacy/incomplete | Seller workflow | resume/error states | Intent, autosave/resume, design convergence incomplete | P1 |
| Buyer Preview | current draft route fallback | draft opens Passport-like detail | Shared presentation | Buyer Preview — not public | Not yet one shared architecture/mode | P0 |
| Publication | publish endpoint/UI | human UAT draft remains private | Governed policy | exact blockers | Core guard works; full lifecycle UI still incomplete | P1 |
| Sold/retired persistence | Passport + Marketplace | not yet exercised on human UAT vehicle | Governed lifecycle | sold/no active commerce | Must prove Passport persists after sale | P1 |
| Account continuity | auth | historical buynsellpvtltd login unresolved | Security/auth | secure recovery state | Explicit continuity/recovery workstream required | P0 |
| Dealer/business Seller | registration profile/onboarding | owner-centric current flow | Auth + profile distinction | governed onboarding | Commercial identity vs authorization role under-specified | P1 |
| Responsive | DESIGN.md | partial mobile evidence only | UI contract | responsive | tablet/narrow pass missing | P1 |
| Accessibility | global regression | not Seller-redesign-specific yet | UI contract | accessible states | Must re-certify changed surfaces | P1 |
| Automation inventory isolation | Golden Seller harness | leaked public test Hiluxes | Test/UAT governance | isolated/cleaned | Current harness contaminates human UAT | P0 |
| Meaningful visual fixture | Golden Seller harness | 1×1 PNG | Test/UAT governance | non-trivial image | Existence test passed blank-looking UI | P0 |

## Current authoritative conclusions

1. `UAT20260828SELL01` remains **draft** and is not a public Marketplace listing.
2. Its missing gallery is a real persistence defect; the server cannot reconstruct media that never persisted.
3. The public 2021 Hilux entries that appeared during UAT are automated Golden Seller vehicles, not copies of the human draft.
4. Automated fixtures have contaminated public staging inventory and Home/Marketplace visual selection.
5. Canonical Trust for the human UAT vehicle is **not evaluated**; legacy/unversioned score must remain unpublished.
6. The current Golden Seller test is an integration lifecycle test, not the full human-facing Golden journey required by the execution plan.
