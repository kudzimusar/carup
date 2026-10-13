# OC-NATIVE-LR1-R5 — CarUp native visual system and shell decision

**Starting technical authority:** `109dfbf9d8a911e90b7adb7ff288cd7d15c03619`
**Programme:** One CarUp Native
**Scope:** Home, Check / Verify, global native shell only
**Product/backend authority:** frozen

## Binding visual rule

**FAITHFUL CARUP COMPOSITION, NATIVE EXECUTION, BETTER POLISH.**

The owner reference is binding for the visual language: CarUp lockup, dark/navy hero, warm structural orange, **ONE CARUP · ONE VEHICLE THREAD**, **Buy. Sell. Verify.**, strong orange primary action, secondary Sell / Verify actions, branded search, high-confidence automotive typography and branded bottom navigation.

This R5 pass does not alter Marketplace truth, Trust authority, publication authority, Communications authority, authentication, camera truth or backend contracts.

## Visual system v2

### Canonical brand colours

- CarUp orange: `#F97316`
- CarUp orange pressed: `#EA580C`
- CarUp orange subtle: `#FFEDD5`
- CarUp navy / near-black: `#081B2C`
- Deep navy: `#050D16`
- Raised navy: `#0E2B44`
- Off-white canvas: `#F7F8FA`
- White surface: `#FFFFFF`
- Light divider: `#D8E0E8`

Orange is structural on primary actions, active navigation and selected brand accents. Navy is structural on the hero, navigation and branded information surfaces. Vehicle photography carries visual weight when real media exists; no generated or synthetic vehicle image may substitute for inventory.

### Logo treatment

The native lockup is a compact automotive mark plus the `CarUp` wordmark. `Car` remains light/white on dark surfaces and `Up` uses CarUp orange. No generic app title treatment is used inside the R5 hero.

### Typography

The semantic type scale remains Dynamic-Type compatible. R5 strengthens display hierarchy instead of reducing font size:

- hero eyebrow: uppercase metadata with tracking;
- hero display: heavy, compact automotive headline;
- section headline: strong but subordinate;
- body: 16dp-class semantic body;
- button: 16dp bold;
- prices retain tabular numerals.

### CTA hierarchy

1. **Primary:** filled CarUp orange, navy text, minimum 48dp target.
2. **Secondary on dark:** navy/transparent surface with visible light border and light text.
3. **Tertiary:** text/icon only when clearly subordinate.

### Panels and search

- hero/search composition uses navy as the structural parent;
- search is a high-contrast inset surface with a 56dp minimum height;
- content cards use clear surface separation and generous radii;
- branded empty/error states retain the navy/orange identity without inventing content.

### Icon grammar

Use recognizable Ionicons with consistent weight. Icons support meaning; they do not replace labels for high-value Buy / Sell / Verify actions.

## Navigation reconciliation — recorded before implementation

### Current shell

`Home | Market | Inbox | Account`

Strengths:
- direct conversation discoverability;
- four-item simplicity;
- accepted stable technical shell.

Weaknesses against owner direction:
- Sell is demoted into secondary surfaces;
- Verify is demoted into secondary surfaces;
- the shell does not visually express the core CarUp product proposition;
- it reads like a generic utility app rather than the owner-approved automotive product.

### Owner reference shell

`Home | Market | Verify | Sell | Account`

Strengths:
- makes the three core value journeys continuously discoverable;
- matches **Buy. Sell. Verify.**;
- gives Verify and Sell the prominence explicitly requested by the owner;
- creates a branded, memorable navigation rhythm.

Risk:
- Inbox loses a permanent tab.

### Inbox discoverability mitigation

Inbox remains canonical and must stay easy to reach through:
- the Home header message/notification affordance with unread state;
- Vehicle Detail primary **Message seller** action;
- conversation-linked notification deep links;
- Account / My CarUp message entry where appropriate.

This preserves CarUp as the canonical conversation authority without making provider/channel identity a permanent global destination.

### R5 recommendation

**Adopt the owner-reference five-tab shell: Home | Market | Verify | Sell | Account.**

This recommendation is now recorded before implementation as required. The visual checkpoint will implement it only at the presentation/navigation layer; Sell enters the existing governed Sell workflow, and Verify renders the existing governed Check experience. No backend/domain authority changes.

## Check / Verify discrepancy classification plan

At starting source authority, shared `Button` explicitly assigns the primary background from `theme.brand.primary`. The Check screen uses that default primary variant.

Therefore a runtime screenshot showing the `Check CarUp record` label with no filled primary container is **not supported by the starting source definition**. R5 will recapture the exact rebuilt candidate. If the exact candidate renders the filled orange control, the old screenshot is classified as stale artifact/build discrepancy. If the exact candidate still loses the fill, it becomes a rendering/style defect and must be debugged before owner evidence is accepted.

No screenshot manipulation is permitted.


---

## OC-NATIVE-LR1-R5-R1 — visual evidence harness recustody

**Frozen visual product candidate:** `f7e735eb492704068f28eb912bd83bf0567771e2`
**Product visual language:** moderator pass / frozen
**Owner visual acceptance:** not yet formally granted

### Custody correction

The R5 product evidence at workflow run `38212187721` is genuine native iOS Simulator / Android emulator evidence for the accepted visual direction, but its workflow custody was dirty because R5 native visual jobs had temporarily been embedded inside:

`.github/workflows/communication-command-center-ci.yml`

R5-R1 removes that lane contamination by restoring the Communications workflow **exactly** to the Git object present at technical authority:

`109dfbf9d8a911e90b7adb7ff288cd7d15c03619`

The dedicated native visual harness remains the sole R5 visual evidence lane:

`.github/workflows/oc-native-r5-visual-checkpoint.yml`

### Product freeze proof

No `mobile/**` product source is authorized to change in R5-R1.

The Home, Check / Verify, CarUp navy/orange visual language, CarUp lockup, `ONE CARUP · ONE VEHICLE THREAD`, `Buy. Sell. Verify.`, CTA hierarchy, and `Home | Market | Verify | Sell | Account` shell remain frozen exactly as accepted at `f7e735eb...`.

This documentation mutation exists only to trigger the dedicated R5 visual evidence harness at the recustodied exact head. It is **not** a visual iteration.

### Recertification pairing

The recustodied dedicated run must continue to report:

- backend deployment: `dpl_9Q85zjgdKkVGBqXW8WB7aHV6HogC`;
- backend source: `40621751d4b74c59324fe6601aa5ddbdc7769b08`;
- Supabase staging: `eoyenigwevnxwwhyhaer`;
- external communications: `disabled`.

The dedicated harness must recertify the unchanged product on iOS Simulator and Android emulator at the new exact PR head. Owner acceptance remains a separate subsequent gate.


---

## OWNER IA AMENDMENT — 13 OCTOBER 2026 — CANONICAL NATIVE SHELL + DISCOVERY AUTHORITY

**Owner authority:** explicit Owner checkpoint following accepted R5-R3 visual recertification.  
**Moderator disposition:** R5 visual language APPROVED IN PRINCIPLE; product-information-architecture adjustment REQUIRED.  
**Supersedes for all future native work:** every earlier R5 statement that freezes or recommends `Home | Market | Verify | Sell | Account` as the final native shell.

### Binding owner decision

The permanent consumer bottom navigation is now:

`Home | Buy | Verify | Sell | Trade`

This is not optional wording and it is not a cosmetic label experiment.

It is the canonical CarUp native primary-journey model.

The five permanent bottom destinations represent the five primary customer-facing product journeys:

1. **Home** — CarUp overview, discovery entry points, current state and shortcuts.
2. **Buy** — Marketplace discovery, search, filters, shortlist/saved discovery, vehicle detail and buyer journey.
3. **Verify** — VIN/chassis Check, Vehicle Passport, evidence, Trust, PartSentry and governed verification services.
4. **Sell** — seller onboarding, vehicle capture, document intelligence, listing creation, publication/readiness and seller workflow.
5. **Trade** — Trade OS / Diaspora Trade gateway, including governed trade/import, RFQ, logistics, container-sharing/container-space, shipment and trade-service capabilities as they are implemented.

### Market → Buy is mandatory

The current customer-facing tab label `Market` MUST become `Buy`.

The internal Marketplace route/component may remain technically named `marketplace` where safe, but user-facing native navigation must say **Buy**.

Reason:

- Sell is already a first-class standalone journey;
- Verify is already a first-class standalone journey;
- buyer intent must be equally explicit;
- `Buy` is action-oriented and immediately communicates the purpose of the Marketplace destination.

Do not rename backend Marketplace contracts merely to satisfy this presentation rule.

### Account → Trade is mandatory

The current bottom tab `Account` MUST be removed from the permanent bottom navigation and replaced with **Trade**.

Trade MUST NOT be a renamed Account screen.

Trade must route into the real governed Trade OS / Diaspora Trade product surface available to native users. Where parts of the Trade product are not yet implemented natively, the destination must truthfully expose available governed capabilities and designed unavailable/planned states rather than fake workflows.

The Trade destination is a first-class CarUp pillar, not a nested Account utility.

### Account/Profile moves to the header

Personal account access remains essential but is no longer one of the five primary business-journey tabs.

A persistent **Profile** affordance must be placed in the shared native header at the top right.

The Profile control is the entry point to personal/account capability, including current governed Account functions such as identity/account information, memberships/context, personal vehicle/account utilities, preferences where implemented, professional workspace links where authorized, and Sign Out.

The exact Account route may remain internally named `account`; the change is its global navigation placement.

### Notifications and Profile must coexist in the header

The shared header must provide two distinct, evenly composed controls:

`Notifications | Profile`

Requirements:

- both are visible, balanced and touch-accessible;
- Profile uses a recognizable person/avatar/profile icon;
- Notifications uses a recognizable bell/notification icon;
- unread state may be shown only from real notification/unread authority;
- neither control may visually overpower the CarUp lockup or primary page hierarchy;
- safe-area and Dynamic Type behavior must remain correct.

### Communications / Inbox MUST NOT be orphaned

The currently visible Home top-right communication affordance must not simply disappear.

Before replacing it, implementation must identify its current canonical route and preserve access to CarUp Inbox/conversations.

The native communications principle remains:

**CarUp owns the conversation. External providers own transport.**

Inbox/conversation access must remain discoverable through appropriate governed paths, which may include:

- Notifications when the notification is communication-related;
- Vehicle Detail → Message seller;
- conversation deep links;
- Profile/Account → Messages/Inbox;
- other explicit contextual message entry points.

If the current top-right chat affordance is the only discoverable route into Inbox for a required user journey, the agent must preserve an alternative before removing it.

No communications capability may be deleted merely to satisfy header composition.

### Mobile Marketplace discovery parity is part of this amendment

The owner also requires the Buy/Marketplace journey to expose the real discovery power already available in the canonical Marketplace backend.

Mobile must provide a clear **All filters** entry and a native filter sheet/panel for backend-supported discovery controls, including:

- make;
- model;
- year;
- colour;
- body style;
- location;
- fuel;
- transmission;
- minimum/maximum price;
- condition/category;
- governed trust/verification tags;
- sorting.

Governed trust filters include at least:

- Passport Verified;
- PartSentry Checked;
- Dealer Verified.

The visual Home hero remains premium and uncluttered. Discovery uses progressive disclosure rather than a desktop form embedded into Home.

Canonical flow:

`Search → All filters → filter sheet → results`

Results retain filter state and expose `Filters (N)`, Sort, removable active chips, truthful result count, Clear all and truthful zero-result state.

No local-only filtering of the first downloaded page. No fake counts. No demo inventory.

### Navigation continuity

The new shell must preserve:

- current R5 navy/orange design language;
- current CarUp lockup;
- current hero;
- current typography;
- primary CTA hierarchy;
- bottom-tab active-state clarity;
- safe-area handling;
- minimum practical touch targets;
- screen-reader labels and selected state;
- deep-link continuity;
- route authorization;
- feature-governance truth.

One tab represents one primary intent.

`Buy` and `Sell` must remain distinct.

`Trade` must not become a catch-all More menu.

`Profile` must not become a sixth bottom tab.

### Canonical shell state after this amendment

Earlier historical R5 shell:

`Home | Market | Verify | Sell | Account`

is retained in this document only as historical custody.

The binding shell for R5-R4 and all subsequent native propagation is:

**`Home | Buy | Verify | Sell | Trade`**

with:

**`Notifications | Profile`**

in the shared top-right header.

### Implementation boundary

This amendment authorizes native product/navigation presentation changes only when separately dispatched by CA-MOD / native moderator task authority.

It does not by itself authorize:

- backend contract changes;
- database changes;
- publication/Trust authority changes;
- Communications transport changes;
- fake Trade data;
- fake notifications;
- production deployment;
- merge.

### Certification consequence

Any future native visual checkpoint that still presents:

`Market` as the permanent buyer tab,

or:

`Account` as the permanent bottom-right tab,

after implementation authority has been granted is non-conformant to current Owner authority.

R5-R4 must certify the new shell and discovery behavior on both iOS and Android before the native visual language may be propagated further.
