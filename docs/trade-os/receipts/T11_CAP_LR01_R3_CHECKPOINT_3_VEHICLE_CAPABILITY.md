# T11-CAP-LR01-R3 — Checkpoint 3: vehicle capability convergence (Steps E and F)

Authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §8, §16–§18, §30-E/F, §47 (Checkpoint 3), under Moderator rulings D-2 and D-3 and the read-model authorisations (§18–§19 of the release).
Commits: backend read model `99ad2cad`; Passport, Garage and My Listings `e035ebec`; base `bf0134d6`. **No migration. Production not accessed. Staging read with SELECTs only.**

## 1. Result

Checkpoint 3 asks for a comparison of the Serena and the Vezel that proves two things.

| Gate (authority §47) | Proved by |
|---|---|
| Same base vehicle shell | §3 — the Passport and the Garage render both vehicles through one header, one card grammar and one capability description; a test renders the Vezel with the Serena's facts and gets the Serena's card |
| Different capabilities only where real facts differ | §2 — the shipped functions run over the REAL staging rows and give the Serena `published / none` and the Vezel `not_listed / single`; §4 — nothing else moves them |

## 2. The real rows, run through the shipped code

Read through the read-only staging connection on 2026-10-27 (SELECTs only), then fed to the shipped `buildOwnerCapabilities`, `attachLinkedVehicles` and `getJourney` with the real Kingston identity (`u_66cace85fad949e4`) and an outsider.

| | Serena `GFC27-027051` | Vezel `RU3-1316558` |
|---|---|---|
| `owner_id` / `current_seller_id` | Kingston / Kingston | Kingston / **NULL** |
| `publication_status` / `status` | `published` / `Available` | `draft` (the column default) / `Pending` (the import hand-off's placeholder) |
| Seller content | description, 3 features, **price 12,800 USD**, **10 listing photographs** | none: `seller_features []`, price 0, no currency, 0 listing photographs |
| Studio-autosave stamps | — | present on the row (`seller_listing_recorded_at` etc.), and **not even selected**: the capability read's column list excludes them, and a test proves each one alone cannot make a listing |
| Linked import orders (all buyers) | **none** | one: `3e2b66a0…` (`DOCUMENTS_PENDING`, buyer Kingston, 0 live participants) |
| **Derived for Kingston** | `marketplace: published` · `trade_import: none` | `marketplace: not_listed` · `trade_import: single, order_id 3e2b66a0…` |
| Derived for an outsider | no block | no block |
| Order as Kingston sees it | — | gains `linked_vehicle: {vin, title: "2018 Honda Vezel"}` |
| Order as an outsider sees it | — | **unchanged, byte for byte** (no `linked_vehicle`) |
| `getJourney('vehicle')` for the same rows | resolves no order ("No import order … that you can view") | resolves `3e2b66a0…`; for the outsider: refused (`ForbiddenError`) — the capability and the resolver agree |

So the Vezel is **not** a listing: its `draft` default, its import provenance and the autosave timestamps the Studio stamped twice are all deliberately inert (Moderator D-3, §36).

## 3. One shell, two vehicles

| Surface | Serena | Vezel | Shared by construction |
|---|---|---|---|
| Vehicle Passport | header + Marketplace cell "Published on Marketplace → Manage listing"; **no** Trade & Imports cell, no CAP action, no word about imports | same header + Marketplace cell "Not listed → Sell this vehicle" + Trade & Imports cell "Import journey available → View CAP", "Import order" | `SellerWorkspaceHeader`, `VehicleCapabilityPanel`, `capabilityPresentation` |
| My Garage card | Relationship · Marketplace · Garage record | the same three cells, plus a Trade & Imports row and a View CAP action | the base grid; the extra row exists only when a capability exists |
| My Listings | **listed** (published) | **not listed** (a never-listed vehicle is not a listing) | one derivation on the server |

Proved by tests rather than by eye:
* `MyGarage.capabilities`: both cards have the same first three cell labels in the same order; the Vezel adds exactly one more; each carries exactly one Marketplace action; **a Vezel given the Serena's facts renders as the Serena** — there is no "imported vehicle" class.
* `VehicleProfile.capabilities`: the page has exactly one `h1` (the vehicle), labels `<main>` with it, names the workspace (My Vehicles), the parent ("Back to My Garage") and a trail ending in the vehicle.
* `capabilityPresentation`: the Marketplace description and the Trade description are separate pure functions; a test varies each across all states of the other and shows neither moves.

## 4. Isolation and authorisation

* **Audience.** The block is built only for the vehicle's owner or current seller under a *proven* identity (`identityAsserted` is refused; anonymous callers cost no query). A stranger **and a platform admin who owns nothing** get the passport object back unchanged. Order vehicle titles follow the same standing.
* **Unreadable = none.** An order the viewer cannot read yields exactly the answer "no order": no count, no id, no title. Proved for the owner of a vehicle whose only order is someone else's, and for mixed vehicles.
* **One interpretation of import ownership.** `getVehicleJourney` and the capability read share one pure rule (`selectReadableOrders`); a 48-case matrix (8 vehicles × 6 viewers, including the `admin` platform role that is *not* in the reviewer set) proves they agree.
* **Failed read ≠ none.** A failed order or participant read marks the vehicle `unavailable`; `getVehicleJourney` now **throws** on a failed read instead of answering "no journey" (this changes R1/R2 behaviour only on a database fault; a test pins both halves).
* **Domain isolation.** The listing state and the import state never read each other (tested in both directions); the derivation never reads `publication_status='draft'`, `import_source`, or any column the Studio autosave stamps (each tested alone).
* Everything is read-only; two reads in total however many vehicles; chunked at 100.

## 5. Decisions taken inside the ruling (so they can be overruled)

1. **Absent `capabilities` means "not sent", and the surfaces say so.** The Passport shows nothing (correct for someone else's vehicle); the Garage says "Listing state not loaded" and offers no listing action; My Listings **fails open** — every vehicle is shown with a notice — because hiding a real listing from its seller is the worse error. A healthy response never shows either notice.
2. **A vehicle whose Marketplace state could not be read is not listed in My Listings and is counted in a notice** ("N of your vehicles could not be checked … It is not shown here, and CarUp has not concluded it is unlisted").
3. **The Garage no longer calls a never-listed vehicle "Availability: Pending".** `Pending` is the import hand-off's placeholder; "availability" describes a listing.
4. **`View CAP` goes straight to the order** (`/diaspora/journey/import_order/:id`) when exactly one readable order exists; the vehicle resolver is used only for the chooser.
5. **The passport route makes no vehicle read of its own**: it calls `readOwnerCapabilitiesForVin`, which reads named columns inside the service. (My first version used a star select in `server.js`; the Phase-1 read-contract guard correctly refused it.)

## 6. Evidence

| Check | Result |
|---|---|
| New backend tests (`t11-cap-r3-*`) | marketplace 11 · import capability 21 · owner capabilities 23 · order vehicle 13 = **68**, all passing |
| R2 tests updated deliberately (the invariants they guard are kept; they now describe the new composition) | `t11-cap-r2-capability-headers` (H3 re-pinned, **H2b added**), `governed-media-wiring` (W10 re-pinned, the garage harness registers `buildOwnerCapabilities`, **W14–W16 added**) |
| Wider backend run around the touched code (27 files) | **563 tests, 561 pass, 2 fail** — both in `passport-v16-runtime-convergence`, which **fails identically on the untouched R2 code `6c13fdc4`** (inherited, not R3) |
| Backend mutation pass (marketplace, journey read model, capability service, server wiring, order context) | **67 mutants: 66 killed, 1 survivor** — `V: anonymous callers are queried`, an equivalent mutant: the service repeats the route's `actor.id` check, so removing the route's copy cannot change behaviour |
| New web tests | Passport capabilities 14 · Garage capabilities 14 · My Listings capabilities 11 = **39** (plus the 62 of Checkpoint 2) |
| Web regression, directories touched | owner pages **10 files / 121 tests**, all passing |
| Types gate (`tsc --noEmit -p tsconfig.app.json`; negative control proved in Checkpoint 2) | exit 0 |
| Lint on every changed source | 8 errors, **all pre-existing and identical on `6c13fdc4`** (4 non-component exports in `MyListings.tsx`, 4 in `types/index.ts`); **0 new** |
| Real-data run | §2 |

Defects found while doing this step and fixed in it (not in the original plan): `getVehicleJourney` folded a failed read into "no journey"; my first Passport read used a star select (refused by the read-contract guard); my own wiring assertion was too crude (`linked_vehicle_vin` contains `linked_vehicle`); two of my mutation survivors exposed a missing *no further reads for a stranger* assertion and a missing `admin`-platform-role case. The survivors that remain are documented as equivalent, not hidden.

## 7. Not yet done

Step G (CAP chrome), Step H (Trade parent flow: Import Orders, Order detail, Documents, Shipping, Customs, Messages), Step I (Seller regression and the D-1 autosave guard), Step J (responsive and accessibility at 390 / 768 / 1280 / 1920), Step K (physical Kingston UAT on an exact-head candidate), the web mutation pass, the full regressions and the R3 PR.
