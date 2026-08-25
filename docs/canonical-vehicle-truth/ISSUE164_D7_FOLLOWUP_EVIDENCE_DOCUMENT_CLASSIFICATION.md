# D7 follow-up — "verified documents" counts one thing, the list shows another

**Status:** OPEN follow-up. **Deliberately NOT fixed inside Issue #164.**
**Raised by:** Phase 8 Run 4 physical UAT, 2026-08-25, while grading Step 16 on Golden A.

## The measurement

On one screen, for `CARUPGLDNA0000001`:

| Surface | Shows | Source |
|---|---|---|
| My Garage card badge | **4 verified documents** | `ownerGarageCounts.verified_documents` |
| Vehicle page → *Evidence & Media* | **3 items** | `documentTypes` filter in `VehicleProfile.tsx` |

Ground truth in canonical staging — four `verified` rows on this VIN:

| `evidence_type` | `verification_status` | rendered in the list? |
|---|---|:--:|
| `registration_document` | verified | yes |
| `police_clearance_document` | verified | yes |
| `insurance_document` | verified | yes |
| **`inspection_photo`** | verified | **no** |

## Why they diverge

Two definitions of "document", neither wrong on its own terms:

- **The count** (`backend/server.js`, `ownerGarageCounts`) tallies every `vehicle_evidence` row whose
  `verification_status` is in `('verified','confirmed','approved')`. It applies **no type filter**, so
  `inspection_photo` counts.
- **The list** (`web/src/pages/dashboard/owner/VehicleProfile.tsx`) filters to a hard-coded
  `documentTypes` array — `registration_document`, `insurance_document`,
  `police_clearance_document`, `ownership_transfer_document` — which **excludes** `inspection_photo`.

## Why it was not fixed here

Resolving it requires deciding **whether a verified inspection photograph is a "document"**. That is a
product-policy question about the evidence contract, not a rendering bug, and the owner's closure
scope for #164 explicitly excludes widening into one.

The canonical classification cannot settle it either. Measured on staging:

- `evidence_class_taxonomy` holds **59** rows, so a taxonomy exists;
- but of **20** `vehicle_evidence` rows, only **1** has `evidence_class` populated.

So there is no populated canonical classification to bind either surface to. Picking one of the two
definitions today would be **inventing** the policy, not applying it.

## The question to answer

> Is `inspection_photo` a *document* for the purposes of the owner-facing "verified documents" count,
> or is it a separate evidence class that should be counted and listed separately?

Whichever way it is answered, **both surfaces must then read the same definition** — the count and the
list must not be able to disagree again. The fix is one shared predicate, not two edits.

## Suggested scope when it is taken up

1. Decide the policy above.
2. Populate `evidence_class` (or an agreed equivalent) so the answer is a stored governed fact rather
   than a hard-coded array in a page component.
3. Derive **both** the count and the list from that single definition.
4. Regression test: a vehicle with a verified `inspection_photo` must show a count equal to the number
   of items actually listed.
