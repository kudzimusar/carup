# CarUp Native Design System v1

This document records the design grammar implemented by OC-NATIVE-LR1. It is native implementation authority for this lane unless superseded by moderator direction.

## Product character

CarUp native is **confident automotive utility**:

- vehicle-led, not dashboard-led;
- search and useful content before marketing copy;
- restrained navy + amber;
- evidence explained progressively;
- one dominant decision per screen with subordinate routes;
- real Marketplace truth only.

## Palette

Brand navy remains the trust/structure colour. Amber remains the brand signal and primary emphasis. White text on the legacy `#F97316` orange is not used as the universal CTA treatment because that pair measures about 2.8:1. The launch primary pair is dark navy on amber, about 7.77:1.

Semantic groups implemented in `mobile/theme/tokens.ts`:

- `brand.primary / primaryPressed / primarySubtle / onPrimary`
- `background.canvas / surface / surfaceRaised / surfaceSunken`
- `text.primary / secondary / muted / inverse`
- `border.default / strong`
- `state.success / warning / danger / info` plus subtle counterparts
- `overlay.scrim`
- `focus.ring`

Warnings do not mechanically reuse brand amber.

## Theme behaviour

`useNativeTheme()` follows the platform colour scheme. Screens must not independently choose a theme.

## Typography

Semantic React Native point-size tokens retain operating-system font scaling:

- display
- titleLarge
- title
- headline
- body
- bodyStrong
- label
- metadata
- priceLarge
- priceCompact
- button

No global `allowFontScaling={false}` is allowed.

## Spacing and shape

A small 4pt-based spacing scale and bounded radius scale replace per-screen arbitrary values. Controls, buttons, inputs, chips, cards, image cards, sheets and modals have deliberate roles.

## Buttons

- Primary — brand amber with dark/navy foreground.
- Secondary — surface + strong border.
- Tertiary — quiet/no container.
- Destructive — semantic danger.
- Provider — only when a real provider/channel action is invoked.
- Icon button — 48dp square minimum.

## Chips and pills

- **Filter chip:** interactive/reversible; selected state also uses a checkmark.
- **Status pill:** informational and must not expose button semantics unless interactive.
- **Trust/evidence signal:** evidence-backed only. Unknown remains unknown.
- **Channel/provider:** recognisable provider identity only for a real provider action.
- **Count/metadata:** visually quieter than actions.

## Fields

`Field` and `SearchField` provide shared native form/search grammar with OS font scaling, accessible labels, helper/error copy and 48dp minimum interaction height.

## States

Reusable states: loading/skeleton, empty, partial, success, warning, error, offline, retry, permission required, processing and pending review.

## Motion

Motion confirms, orients or explains. It does not decorate or delay useful content. Token durations exist for quick feedback, standard transitions and sheets.

## Accessibility

- 48dp practical minimum in new primitives.
- Semantic labels and interaction states.
- Selected filters do not rely only on colour.
- Font scaling remains enabled.
- Errors can be announced through a live region.
- Safe-area-aware sticky actions use the device inset.

## Legacy migration

Untouched legacy screens may temporarily retain older inline styles. Every screen touched by LR1 should move toward this grammar rather than create another styling island.
