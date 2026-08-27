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
