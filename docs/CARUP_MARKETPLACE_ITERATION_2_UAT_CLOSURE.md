# CarUp Marketplace Iteration 2 — UAT Closure Matrix

Status: ACTIVE on PR #182
Baseline before Iteration 2: `1242494ebfef8623332bd0c170e3e8a097cc7d10`
Execution rule: sequential phases only; no parallel Marketplace feature lane; no production activation.

## Governing objective

Turn the now-functional Marketplace into a coherent CarUp commerce/trust product:
truth convergence first, then page roles, conversion, taxonomy, visual identity, data richness, and exact-head certification.

## Phase acceptance matrix

| Phase | Goal | Must be true before exit |
| --- | --- | --- |
| 1 | Freeze/reconcile UAT | Every owner finding is represented by code/test acceptance criteria. |
| 2 | Canonical vehicle lifecycle | One VIN tells one public-safe story across Vehicle History, History Report, Evidence Vault, ownership, service/repair, inspection and mileage. |
| 3 | Home vs Marketplace IA | Home explains/promotes the ecosystem; Marketplace is inventory-first. |
| 4 | Home responsive hero | No tab/search overlap; phone/tablet/desktop preserve flow. |
| 5 | Progressive selling + app shell | Guest may build a listing draft before auth; compact nav remains present on Sell and Account/auth journeys. |
| 6 | Vehicle Detail hierarchy | Gallery/vehicle identity lead the page; Passport intelligence follows. |
| 7 | Buyer action activation | Visible primary CTAs work or truthfully route to the next safe step; no dead-looking controls. |
| 8 | Vehicle taxonomy | Dense make/model/year/body/colour vocabulary replaces the hard-coded ten-make list. |
| 9 | Parts fitment | Parts may declare normalized vehicle compatibility against the same taxonomy. |
| 10 | CarUp visual language | Less generic glass/card/pill repetition; image-led, editorial automotive composition by surface. |
| 11 | Reference data richness | Staging shows coherent differentiated vehicle histories without fabricated conclusions. |
| 12 | Exact-head certification/UAT | Exact frontend/backend provenance, CI, lifecycle/taxonomy/guest-sell tests, deployed desktop/tablet/mobile screenshots, then owner UAT. |

## P0 truth acceptance cases

Golden Hilux `CARUPGLDNA0000001` must converge the facts already recorded by CarUp:
- one recorded ownership transfer must not coexist with a History Report count of zero;
- the recorded PartSentry brake-pad replacement must appear as service/repair history and may carry its recorded 78,450 km mileage observation;
- verified inspection evidence must not coexist with a zero inspection count when that evidence supports an inspection event;
- registration, insurance and police-clearance documents must NOT be classified as accident records merely because an old legacy evidence mapping grouped them there;
- absence of an accident event must be phrased as absence in current coverage, never proof that no accident occurred.

## Conversion acceptance cases

- Signed-out `Sell` opens a guest listing builder, not `/register`.
- Guest may enter identity, taxonomy, condition, mileage, location, price and photos and reach preview.
- Authentication is required only at a commitment boundary (publish/persist to account/ownership/evidence/payment).
- Compact bottom navigation remains part of the public/auth app shell.
- Buyer inquiry remains guest-capable; reserve/finance actions explain and initiate the next safe step rather than presenting inert controls.

## Visual acceptance cases

- Marketplace first viewport prioritizes search/filter/inventory.
- Home owns the ecosystem/promotional hero and stakeholder monetization modules.
- Vehicle Detail leads with the car gallery.
- Mobile Home has no overlapping tab/search surface.
- Glass/backdrop blur is not the default material.

## Scope boundaries

- Communications/Email implementation remains untouched.
- Synthetic listing media remains demo advertising media only and never becomes verified evidence or Trust input.
- CarUp Gold remains backend-governed.
- No production merge/activation occurs in this iteration.
