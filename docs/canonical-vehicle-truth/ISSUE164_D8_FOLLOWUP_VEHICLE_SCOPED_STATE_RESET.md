# D8 follow-up — stale vehicle facts can outlive a VIN change on the owner vehicle page

**Status:** OPEN follow-up. **Deliberately NOT fixed inside Issue #164.**
**Severity:** P2. **Raised by:** Codex exact-head review of `41d942a88b25f9372c598a346d1486dfc455b400`,
2026-08-25T02:40:09Z. **Owner adjudication:** real finding, P2, **non-blocking** under the frozen
closure rule — after the frozen final run, newly discovered non-P0/P1 findings become follow-up work
rather than extending Issue #164.

## The finding, verbatim

> **Clear prior vehicle facts before loading a new VIN**
>
> When navigation changes `/dashboard/garage/:id` without unmounting this component, both
> `evidenceList` and `passportData` retain the previous vehicle while the two new requests resolve
> independently. If the new passport arrives before its evidence, this predicate can render the
> previous vehicle's verified-logbook badge beside the new vehicle; the inverse can retain the old
> insurance/PartSentry claims, and a failed request leaves the mismatch indefinitely. Reset both
> datasets on `id` changes and ignore responses belonging to superseded VIN requests before
> evaluating these badges.

Location: `web/src/pages/dashboard/owner/VehicleProfile.tsx:266`.

## Why it is real

The D4 remediation bound each claim badge to a governed fact, but it reads those facts from **two
independently-resolving sources** held in component state:

- `passportData` — from `fetchVehiclePassport(id)`, backing `hasActiveInsurance` and
  `hasPartSentryActivity`;
- `evidenceList` — from `fetchVehicleEvidence(id)`, backing `hasVerifiedLogbook`.

Neither is cleared when `id` changes, and neither request is tagged with the VIN it belongs to. The
component only unmounts on some navigation paths; an in-place `:id` change keeps it mounted.

## Reproduction condition

1. Open `/dashboard/garage/<VIN-A>` for a vehicle with a **verified** logbook and let it settle.
2. Navigate in-place to `/dashboard/garage/<VIN-B>` for a vehicle whose logbook is **pending** —
   without a full page reload, so the component is not unmounted.
3. In the window where VIN-B's passport has resolved but its evidence has not, `evidenceList` still
   holds VIN-A's verified document, so `hasVerifiedLogbook` is true and **VIN-B renders
   "Logbook Verified"**.

The inverse ordering retains VIN-A's `Insurance Active` / `PartSentry Active` against VIN-B. If
either request **fails**, the stale dataset is never replaced and the mismatch persists indefinitely
rather than for a moment.

This is the D4 defect class reappearing through a different door: a badge asserting a verification
that the vehicle on screen does not have. It is narrower — a transient race on in-place navigation
rather than an unconditional claim on every render — which is why it is P2 and not P1.

## Requirements for the fix

1. **Reset vehicle-scoped state on `id` change.** Clear `passportData` and `evidenceList` (and any
   other VIN-scoped state) when `id` changes, so the page renders a loading state rather than the
   previous vehicle's facts.
2. **Ignore superseded async responses.** Tag each request with the VIN it was issued for and discard
   any response whose VIN is not the current `id` — an `AbortController` per `id`, or a captured-`id`
   guard before `setState`. Without this, a slow response for VIN-A can still land after VIN-B has
   loaded and overwrite correct state with stale state.
3. **Evaluate badges only against same-VIN data.** The badge predicates must not be able to combine a
   passport from one vehicle with an evidence list from another.

## Regression test to add

Render the page for VIN-A (verified logbook), change `id` to VIN-B (pending logbook) **without
unmounting**, resolve the passport before the evidence, and assert that `badge-logbook-verified` is
**absent** throughout — including in the intermediate frame. Add the inverse ordering for the
insurance and PartSentry badges, and a failed-request case asserting no stale badge survives.

## Not changed here

Per the owner's release-gate decision, **no executable `#165` code was modified for this finding.**
The certified candidate `41d942a8` stands, and the final physical UAT (32 PASS / 0 FAIL / 0 BLOCKED)
is not reopened.
