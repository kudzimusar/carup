# CarUp Owner Dashboard — Electric Redesign Plan

**Status:** Approved visual direction for implementation  
**Scope:** Frontend/UI only  
**Database impact:** **NONE**  
**Backend/API contract changes:** **NONE**  
**Reference:** Owner-approved high-fidelity CarUp dashboard mockup from UAT, 2026-08-14

## 1. Objective

Redesign the Owner Dashboard into a premium, electric, action-oriented automotive trust control center. The page must immediately tell an owner:

1. what they own;
2. what is active now;
3. what needs attention;
4. what they should do next;
5. what recent activity has occurred across their CarUp journey.

The dashboard should feel alive even for a new account, without inventing data.

## 2. Non-negotiable safety boundary

This work is presentation-layer only.

- Do not add or modify database migrations.
- Do not change schema, RLS, grants, policies, triggers, or stored procedures.
- Do not mutate production or staging data.
- Do not add backend write endpoints.
- Do not change existing API semantics.
- Do not fabricate wallet balances, user trust scores, valuation history, verification status, documents, conversations, listings, or notifications.
- Continue to use caller-scoped API reads already exposed by `useCarUpApi`.

The existing Owner Dashboard truthfulness contract from Issue #128 remains authoritative.

## 3. Approved visual direction

### Mood

- electric, premium, modern automotive technology;
- trust-first rather than finance-first;
- high contrast but not visually noisy;
- white / warm gray surfaces;
- deep navy and charcoal typography;
- electric orange as the primary action accent;
- green for healthy/verified vehicle state;
- blue for trust/security context;
- purple for saved/interest state;
- subtle gradients, glow, border highlights, and soft shadow depth.

### Composition

Preserve the existing CarUp shell and role navigation, but make the Owner Dashboard itself feel more like a control center than a grid of system-status cards.

Desktop hierarchy:

1. electric welcome hero;
2. live quick-stat strip;
3. main two-column content area;
4. My Garage preview;
5. Saved Cars preview;
6. Needs Your Attention;
7. Next Best Step;
8. Recent Activity;
9. Trust & Value Snapshot;
10. Gutu AI action card;
11. secondary owner tools (SafePay/Wallet context, Insurance, PartSentry, Import Orders, Evidence Vault).

Mobile hierarchy stacks the same sections in action priority order.

## 4. Data sources — read only

The redesign may consume only existing caller-scoped reads:

- `fetchOwnedVehicles()` — owned vehicle preview and vehicle count;
- `fetchSavedMarketplaceListings()` — Saved Cars preview and count;
- `fetchNotifications()` — recent activity and unread attention;
- `fetchSafePayEscrows()` — authoritative escrow amount/count only;
- `fetchCommunicationThreads()` — open-conversation count and next-action context.

Derived UI values are allowed only when clearly derived from authoritative rows already returned to the caller. Examples:

- Active Listings = owned vehicles whose `publication_status` is `published`.
- Vehicle Trust Average = arithmetic mean of available vehicle `trust_score` values. This must never be labelled as a user/account Trust Score.
- Open Conversations = communication threads whose status is not `resolved` or `closed`.

If a read fails, the associated panel must degrade gracefully and must not display fallback demo data.

## 5. Hero

Headline:

> Welcome back, {Owner Name}

Supporting copy:

> Here’s what’s happening with your vehicles and account today.

Primary actions:

- Add Vehicle → `/dashboard/garage`
- Browse Marketplace → `/marketplace`
- Ask Gutu AI → `/dashboard/ai`

Visual treatment:

- orange-to-amber energy gradient;
- subtle automotive linework / Car icon treatment;
- optional first-owned-vehicle image when available;
- no remote hero image dependency is required to render the design.

## 6. Quick stats strip

Use five compact cards:

- My Vehicles
- Active Listings
- Saved Cars
- Open Conversations
- Vehicle Trust

Rules:

- numbers must come from current caller-scoped reads;
- if vehicle trust cannot be calculated, show an action-oriented `Start`/`Add vehicle` state instead of a made-up percentage;
- each card links to the relevant working route.

## 7. Needs Your Attention

This panel is dynamic, not hardcoded status theater.

Candidate actions:

- Add your first vehicle — when `vehicles.length === 0`;
- Save a Marketplace vehicle — when `savedCars.length === 0`;
- Review new activity — when unread notifications exist;
- Continue conversations — when open Communications threads exist;
- Review vehicle trust / Passport — when an owned vehicle has no `passport_verified` flag;
- Publish a vehicle — when the owner has vehicles but no published listing.

Show at most four items, highest-value first.

If nothing needs attention, show a positive state and a Marketplace discovery action.

## 8. Next Best Step

One bold orange CTA card chooses the highest-value next action:

1. no vehicles → Add your first vehicle;
2. vehicles but no active listing → Prepare a vehicle for sale;
3. open conversations → Continue your conversation;
4. saved vehicles → Review saved cars;
5. otherwise → Explore Marketplace.

The card must feel energetic, but navigation remains ordinary client-side routing; no database write is triggered by this card itself.

## 9. My Garage preview

If populated:

- show the leading vehicle;
- image if available;
- year/make/model;
- VIN;
- mileage;
- publication/status context;
- vehicle trust score if supplied;
- progress bar for the vehicle trust score only;
- link to the vehicle profile.

If empty:

- show a designed empty state;
- explain what My Garage does;
- provide an Add Vehicle CTA.

## 10. Saved Cars preview

Use up to three saved Marketplace listings.

Show only existing listing fields:

- image or honest image placeholder;
- price;
- year/make/model;
- trust score if supplied;
- seller type if supplied.

If empty, show a Marketplace discovery CTA rather than a blank panel.

## 11. Recent Activity

Use current notifications as the authoritative activity feed.

- do not invent timestamps or events;
- distinguish unread visually;
- show an honest empty state when there is no activity.

## 12. Trust & Value Snapshot

This section must preserve Issue #128 truthfulness rules.

Allowed:

- average of owned vehicle trust scores, clearly labelled `Vehicle Trust Average`;
- count of owned vehicles;
- published-listing count;
- SafePay active escrow count;
- caller-scoped activity indicators.

Not allowed unless/until a dedicated endpoint exists:

- user/account Trust Score;
- fake profile verification status;
- fabricated valuation series;
- fake market-value trend.

The existing `value-trend-unavailable` truthfulness state remains visible when no valuation endpoint exists.

## 13. Wallet / SafePay treatment

Wallets move out of the dominant first-row position.

The dashboard may still explain that USD/ZiG wallet balances are not yet available because there is no authoritative per-user wallet endpoint. Preserve:

- `wallet-usd-value = Not available`
- `wallet-zig-value = Not available`

SafePay remains authoritative and may display the live caller-scoped escrow total/count from `fetchSafePayEscrows()`.

## 14. Evidence Vault treatment

Preserve the existing anti-fabrication control:

- no fake OCR upload;
- no simulated document rows;
- dashboard upload button remains disabled until a real supported dashboard upload flow exists;
- retain the truthful `No documents uploaded yet` empty state;
- retain the explanation that upload is not available from this dashboard yet.

## 15. Gutu AI

Add a dark, high-contrast Gutu AI Assistant card inspired by the approved mockup.

- no AI call on render;
- CTA only navigates to `/dashboard/ai`;
- copy should position Gutu AI as help for vehicles, pricing, documents, and ownership context.

## 16. Responsive behavior

Desktop:

- 12-column / split content architecture;
- right action rail for attention / next step / AI;
- compact stat row.

Tablet/mobile:

- single-column priority stack;
- stat strip becomes 2-column or horizontally wrapped;
- action cards remain full-width and tap-friendly;
- no horizontal overflow;
- existing mobile sidebar behavior remains unchanged.

## 17. Accessibility

- preserve semantic headings;
- all icon-only controls retain accessible labels;
- clickable cards must have visible hover/focus states;
- text contrast must meet normal dashboard readability expectations;
- no status meaning conveyed by color alone;
- decorative hero elements are `aria-hidden`.

## 18. Implementation files

Primary:

- `web/src/pages/dashboard/owner/OwnerDashboard.tsx`

Shell enhancement, owner-only where applicable:

- `web/src/components/layout/DashboardLayout.tsx`

Regression coverage:

- `web/src/pages/dashboard/owner/OwnerDashboard.truthfulness.test.tsx`
- optionally a focused visual-contract unit test if needed.

No backend, database, migration, Supabase, workflow-dispatch, or production configuration files are in scope.

## 19. Acceptance criteria

The change is acceptable when:

1. the dashboard visually follows the approved high-fidelity mockup hierarchy;
2. the first screen is action-oriented rather than dominated by unavailable wallet/system cards;
3. empty accounts still feel guided and purposeful;
4. populated accounts show real vehicles, saved cars, activity and Communications context;
5. all rendered numbers are real or transparently derived from real caller-scoped rows;
6. the Issue #128 truthfulness tests remain valid;
7. document upload remains non-simulated;
8. no database or backend file is changed;
9. desktop and mobile layouts remain usable;
10. the branch is submitted as a PR for owner approval before merge.
