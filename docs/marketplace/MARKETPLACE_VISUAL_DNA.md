# CarUp Marketplace Visual DNA — Merge Gate

Status: **governing UI contract for PR #182**

This document converts the approved Marketplace design direction into a repository-level gate so visual quality does not depend on conversational memory.

## Product intent

CarUp Marketplace must feel like a serious automotive commerce product with evidence-led trust, not a generic SaaS dashboard and not a glassmorphism demo.

A first-time buyer should meet, in this order:

1. the car,
2. the commercial decision,
3. the governed trust/evidence that supports the decision,
4. the transaction path.

## Visual rules

### 1. Photo-led, not card-led
- Vehicle photography is the dominant visual material.
- Listing imagery gets more area than badges, filters, or metadata.
- Vehicle Detail starts with the listing gallery before Passport/evidence panels.

### 2. Open editorial composition
- Prefer whitespace, bands, dividers, overlap, asymmetric grids and image-led sections.
- Do not turn every section into a rounded rectangle.
- Large radii are reserved for controls where shape communicates interaction (drawers, pills, compact floating actions).

### 3. Automotive anchor palette
- Deep navy/charcoal anchors key commerce surfaces.
- Electric orange marks action and active state; it must not become decoration everywhere.
- White/light surfaces provide breathing room and reading contrast.

### 4. One primary action per decision region
- Search, inspect vehicle, inquire/reserve, or continue selling must each have a clear primary action.
- Secondary actions (save/share/compare) stay compact and visually subordinate.

### 5. Trust is integrated, not stickered on
- Canonical Trust renders only from the canonical projection and only as evaluated when `evaluation_state === evaluated`.
- Seller-stated facts remain visually and semantically distinct from verified/governed facts.
- Missing/unavailable/stale/not-evaluated states stay explicit.
- No legacy score substitution, unsupported Police Checked claim, invented currency, or fabricated evidence.

### 6. Truth & Trust contract is design-invariant
Styling must never change:
- public privacy projection;
- publication eligibility;
- canonical Trust authority;
- evidence allow-list;
- listing-media vs verified-evidence separation;
- server-owned reservation state;
- Communications inquiry seam;
- no staging/production mock inventory fallback.

### 7. Marketplace is inventory-first
- The Marketplace route exposes cars, search, filters and imagery immediately.
- Home explains the wider CarUp ecosystem and must not duplicate the Marketplace composition.
- Filters are progressive and compact; unsupported facets do not render.

### 8. Responsive behaviour is a product contract
- Mobile retains navigation and buying/selling continuity.
- No horizontal overflow.
- Filters become an explicit drawer.
- Vehicle media remains usable with touch-sized controls.
- Guest Sell keeps the draft intact through the authentication boundary.

## Flagship showroom composition

The Marketplace customer journey uses a distinct flagship composition rather than a generic ecommerce grid:

- **Live showroom hero:** the first published result can provide the visual spotlight; it is real listing media, never stock decoration.
- **Search command deck:** search is the dominant shopping instrument, with immediate make/year/location entry and a single progressive filter drawer.
- **Two-column vehicle stories:** desktop inventory is deliberately larger and more image-led than a dense three-column catalog.
- **Trust lens:** canonical Trust is rendered as a decision signal with its evaluation/confidence state, not as a decorative green badge.
- **Visual compare shortlist:** selected vehicles remain visible with imagery and price context before the buyer enters the side-by-side decision room.
- **Vehicle Detail showroom:** listing gallery and the primary buyer decision panel share the above-the-fold stage on desktop; inquiry/inspection actions stay adjacent to price and canonical Trust.
- **Comparison decision room:** the compare route preserves an accessible table while visually prioritising vehicle imagery, price and canonical Trust.

These patterns are informed by current automotive-marketplace and ecommerce UX research (image-first listing presentation, larger-grid search results, unified filter/sort tools, and high-salience decision data), but are implemented as CarUp-specific components rather than copied brand treatments.

## Communicative media layer

CarUp should not leave large decision regions visually empty and then rely on a tiny icon to carry meaning. Media must help the user understand the next move before they finish reading the copy.

Rules:
- **Explain, do not decorate.** Every photo, diagram, illustration or motion cue must answer a user question such as “What happens if I buy?”, “What can Verify show?”, or “How does this stay connected?”
- **Use real listing photography only as listing media.** It must never acquire verified-evidence semantics.
- **Use vector/diagram scenes for conceptual journeys.** Verify, Diaspora, finance, protection, service and parts may use illustrations because they communicate process without pretending a real event happened.
- **Keep signals sparse.** A visual region should normally carry no more than 2–3 callouts. The media should fill intentional whitespace, not compete with headings or CTAs.
- **Motion is subordinate.** Prefer hover/focus transforms and route/timeline reveals; no autoplay carousels, flashing scores or motion required to understand the UI.
- **Mobile stacks calmly.** Copy remains first, media follows, and the combined story must not create horizontal overflow or push persistent navigation off-screen.
- **No fake gamification.** CarUp may reward exploration through progressive reveals and interactive state, but it must not invent completion scores, verification achievements or user progress that is not actually stored.
- **Communicative copy remains truthful.** Capability language such as “Compare up to 4” or “Open what is known” is allowed; claims such as “Trust checked”, “accident free”, “approved finance”, or “insured” require canonical supporting state.
- **Home gets the richest storytelling.** The eight useful next moves are allowed larger editorial media because Home is the sales/marketing/communication surface.
- **Marketplace stays inventory-first.** Communicative media appears only after real inventory has begun, as a restrained decision-story interlude rather than another hero that delays shopping.

## Connected public surfaces

The Marketplace visual system is not allowed to stop at `/marketplace`.

### Home — sales, marketing and communication front door
- Home sells the breadth of CarUp, while Marketplace sells the vehicle.
- A live Marketplace vehicle can anchor the hero, but Home must not duplicate Marketplace search/result composition.
- Primary conversion journeys expose Buy, Sell and Verify immediately.
- Secondary journeys expose Diaspora/imports, finance, insurance, garages/service and parts without hiding them behind generic “products” navigation.
- Live inventory on Home reuses the same `MarketplaceListingCard` vehicle-story component as Marketplace.
- Home includes one communication layer: Gutu AI for guided discovery, Help for self-service and Contact for human handoff. It must not advertise provider channels that staging/runtime cannot actually support.

### Verify — trust-oriented showroom companion
- `/search` uses the same current vehicle-story component as Marketplace rather than an older card treatment.
- Exact VIN lookup remains visually and semantically distinct from protected identifier lookup.
- An empty protected lookup is never styled or worded as proof that a vehicle does not exist.
- Browse results remain published Marketplace inventory and retain canonical Trust/missing-data semantics.
- Desktop and mobile Verify must remain visually continuous with Marketplace while keeping verification policy more prominent than merchandising.

### Saved Cars — buyer shortlist
- Saved Cars reuses the same current vehicle-story component and truth-aware listing adapter.
- The saved state is expressed through the existing favorite control rather than a separate legacy card.
- Removing a saved vehicle must not mutate listing facts or Trust presentation.
- Operational seller/dealer inventory tables are intentionally not forced into this buyer-showroom card system; their primary job is management, not discovery.

## Design-tool workflow

For future visual expansion:
1. audit the live surface and protected contracts;
2. use high-fidelity design tooling (Google Stitch when available) to explore composition before broad code changes;
3. obtain owner visual approval for the direction;
4. lock/update this Design DNA;
5. implement in the canonical React/TypeScript/Tailwind product;
6. certify exact-head functionality, responsive behaviour, visual evidence and Truth/Trust invariants.

A tooling outage is not permission to improvise a conflicting design language.

## Merge gate

PR #182 is not UI-mergeable unless the frozen exact head proves:
- TypeScript/lint/build green;
- Marketplace/Vehicle Detail/Sell regression suites green;
- exact-head staging frontend READY;
- real staging Marketplace browser certification green;
- fresh desktop/mobile visual evidence reviewed;
- owner UAT accepted;
- independent review has no merge-blocking finding.
