# Temporal Finding & Disclosure Conflict Policy (Milestone 3)

Implements master plan §8 (temporal comparison) and §9 (seller disclosure conflicts).

## Temporal findings (§8)

A temporal finding compares per-component observations across two evidence sets of the
**same vehicle** at different dates and classifies the change:
`newly_damaged, repaired, replaced, removed_missing, repainted_colour_mismatch, worsened,
improved, unchanged, unable_to_compare` (`backend/services/intelligence/temporalComparison.js`).

Rules:
- **Same-vehicle gate (§8.3):** confidence combines hard identity (VIN 0.99 / chassis 0.95 /
  plate 0.75) with visual similarity as a *supporting* signal only. Below
  `SAME_VEHICLE_MIN = 0.75` a finding is **not publishable** and routes to review.
- **Cautious language (§8.7):** public summaries say "appears" / "is possible" /
  "requires reviewer confirmation". A change is never stated as confirmed unless a reviewer
  confirms it.
- **Default state:** `reviewer_state = 'pending_review'`. Confidence is capped at 0.85 — visual
  inference is never asserted as certain.
- **Public output (§8.9):** only reviewer-confirmed findings with a `public_summary` are
  exposed to buyers; raw model output and internal explanations are stripped.

Example produced (cautious form of the master-plan example):
> "The front bumper appears different between 2021-08-14 and 2022-03-01; replacement is possible
> and requires reviewer confirmation."

## Disclosure conflicts (§9)

Claims are extracted from **immutable listing snapshots** (M2) via transparent keyword/field
rules into `disclosure_claims`, retaining the **exact original text**. Each claim is compared
to historical evidence and classified:
`supported, not_verifiable, possible_conflict, strong_conflict, outdated_claim, resolved_corrected`
(`backend/services/intelligence/disclosureConflict.js`).

Rules:
- **Never accusatory (§9.4):** the engine never labels a seller fraudulent. Public wording is
  neutral and evidence-based ("Historical evidence indicates… while the listing states… This
  may be a disclosure conflict and requires reviewer confirmation.").
- **Governed (§9.6):** conflicts default to `reviewer_state='pending_review'` and cannot reach
  public output until reviewer-confirmed. Buyers only ever see confirmed, public-safe conflicts.
- **Seller response & correction (§9.5):** `applySellerResponse()` records the seller's response
  and appends to an immutable `correction_history`; the original listing snapshot is preserved.
- **Evidence-linked:** every conflict carries the supporting `evidence_ids`.

## What requires human governance (handed to Milestone 5)

- Confirming/amending/rejecting any temporal finding or disclosure conflict before it is public.
- Any trust-score impact arising from a finding (AI raw confidence never becomes trust directly).
- Resolving low-confidence / ambiguous comparisons.
