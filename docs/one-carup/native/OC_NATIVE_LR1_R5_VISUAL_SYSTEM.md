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
