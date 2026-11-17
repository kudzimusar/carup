# RX-05 media, imagery and film register

Programme: CARUP-RX05-UI-REBUILD-LR01 (Premium Dealer and Independent Reviewer). Status of paid generation in RX-05: **not authorised** (Higgsfield balance untouched). Everything new in RX-05 is code-authored artwork or a re-use of media the Owner already approved; new films below are **shot specifications** for the brand/media specialist.

## 1. Imagery in use

| ID | Asset | Kind / source | Rights & provenance | Disclosure shown | Where it may appear | Never |
|---|---|---|---|---|---|---|
| M-01 | `ShowroomFloorScene` (`web/src/components/media/rx05/AutomotiveScenes.tsx`) | Original CarUp artwork, SVG + CSS drawn in code; no external file, no AI model | CarUp-authored in RX-05; tokens only | "Illustration · original CarUp artwork, not inventory" | Dealer directory hero; a dealer profile hero ONLY when the dealer has no approved public cover; Dealer empty states | As a dealer's premises, stock, or behind reviewer case evidence |
| M-02 | `TradeRouteScene` (same file) | Original CarUp artwork, SVG drawn in code; milestone states are props | CarUp-authored in RX-05 | "Illustration · not a live shipment" | Trade entry and order detail (RX-06), DEV prototype now | As a vessel position, ETA or shipment record |
| M-03 | `VehicleSilhouette` | Existing RX-03 code-drawn silhouettes (unbadged) | CarUp-authored | Part of M-01 | Inside M-01 | As a listed vehicle |
| M-04 | `SOURCING_FILM` (landscape 1600×894 + portrait 720×1288, 9.1 s, webm+mp4, posters 120 kB / 74 kB) | Higgsfield Kling 4.0 from GPT Image 2.6 keyframes | Owner-approved 2026-11-16; full provenance, hashes and licence in `web/src/content/media/homeFilms.data.ts` | "Editorial film · AI-generated, not a shipment record" | Home sourcing section (RX-03); Trade entry composition in the RX-06 north-star (DEV) | Inside an order, behind documents, payments or customs data |
| M-05 | Dealer-owned images (company cover/profile, showroom, branch, service bay) | Uploaded by the dealership | Dealer attests ownership (`DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO`) | Owner's private preview labelled "awaiting independent review — only you can see it" | Public only after `APPROVED_PUBLIC_DISPLAY`; private previews in the owner's workspace | In public before approval; replaced by generated imagery |

Delivery rules (all placements): poster or static art first; video only on screen in a visible tab; reduced motion or Data Saver → poster only and no video request; pausable motion over five seconds; lazy poster below the fold (RX07 rule); no cinema in signed-in operational or reviewer areas.

## 2. Asset size and impact

- M-01/M-02/M-03 are code: no network requests, no image bytes. They ship inside the chunks that use them (measured in the RX-05 performance section).
- M-04 is unchanged from RX-03/RX-07 (posters 122,596 B and 74,416 B; video 0.68–1.52 MB, never requested under reduced motion / Data Saver).

## 3. Film shot list — Dealer visual programme (specification; generation not authorised)

Common rules: unbadged, no manufacturer marks or readable plates, no identifiable faces, no readable documents, certificates, stamps, dealership names or signage; CarUp orange only as light. Disclosure on every cut: "Editorial film · AI-generated, not a dealership or vehicle record". Deliver landscape 16:9 (≥1600 px) and portrait 9:16 (≥720 px), 6–9 s loops, posters, sha256 hashes, generation ids, and Owner approval before ingestion via `HOME_FILM_INGESTION.md`.

| Shot | Purpose / placement | Duration · camera | Content | Must not show |
|---|---|---|---|---|
| D1 Showroom at opening | Dealer directory hero (public) | 7 s · slow dolly along a light rail | Glass showroom at blue hour, lights coming on over three unbadged vehicles | A real dealership, signage, brand marks |
| D2 Inventory editorial | Dealer profile "inventory" band when stock exists (public, behind real listings, never in place of them) | 6 s · macro rack-focus | Detail textures: stitched leather, alloy spoke, dash glow | Any specific listed vehicle; plates; odometers |
| D3 Operations | Dealer marketing page / onboarding (public) | 6 s · overhead | A tidy yard being arranged at dawn, people as small silhouettes | Staff faces; documents; screens with data |
| D4 Ownership & trust | Claim-your-dealership section (public) | 7 s · gentle orbit | Keys and a folded ownership folder on a counter, out of focus | Readable papers, stamps, IDs, verification seals |

## 4. Film shot list — Trade visual programme (specification; generation not authorised)

Disclosure on every cut: "Editorial film · AI-generated, not a shipment record". Same delivery rules.

| Shot | Duration · camera | Content | Must not show |
|---|---|---|---|
| T1 Dawn at the origin port | 6 s · slow push-in | Quay cranes against first light; rows of unbadged vehicles | Readable company marks, plates |
| T2 The lift | 5 s · low angle, crane tracking | A container rises; one unbadged pickup visible before doors close | Carrier logos, container numbers |
| T3 Crossing | 6 s · aerial drift | Container vessel on open sea at golden hour | Hull names, carrier marks |
| T4 Arrival and clearance | 5 s · handheld, shallow focus | Port gate at dusk, officer silhouette, papers out of focus | Readable documents, stamps, authority emblems |
| T5 Handover in Harare | 7 s · gentle orbit | Keys passed between two hands beside the vehicle under jacaranda | Identifiable faces, plates |

Placement (RX-06): T1–T3 public Trade entry hero; T5 order-completed celebration (public share card only with the buyer's consent); T4 editorial only. Never inside an order's documents, customs or payments views.

## 5. Dependencies

- Owner decision to authorise paid generation (or supply licensed footage) for D1–D4 / T1–T5.
- Brand/media specialist: keyframes → Owner review → ingestion with hashes (`HOME_FILM_INGESTION.md`) → `review: 'approved'` only after the Owner approves the exact cut.
