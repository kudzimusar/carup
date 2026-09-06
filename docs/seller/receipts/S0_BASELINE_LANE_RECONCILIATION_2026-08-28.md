# S0 Baseline & Lane Reconciliation Receipt — 2026-08-28

**Programme:** Seller Journey 1.0  
**Phase:** S0 — Vehicle Taxonomy & Seller Contract Foundation  
**Decision:** IN PROGRESS / RUNTIME WRITE BLOCKED BY ACTIVE LANE OWNERSHIP  
**Canonical main:** `ba208963d863654157335189c60f587cbe330041`  
**Seller docs PR:** #186

## Live heads at receipt time

| PR | Purpose | Head | State |
|---|---|---|---|
| #182 | Marketplace buyer↔seller reliability/reference UX | `be38e48c447ad19a4b50cddd29c8747e5da80811` | Draft, open |
| #183 | Email Experience & Design System 1.0 | `507530aadff17ec8aa4830d3cb392efda6876031` | Draft, open |
| #185 | CarUp Intelligence 1.0 | `0b9fa0304878b3d16210db55fb2a3f7f1261f65d` | Draft, open |
| #186 | Seller Journey 1.0 documentation/S0 | current branch head | Draft, open |

## Drift observed during this work

S0 initially audited PR #182 at `0d6df68f5003e209269f19cca54ead85cdab0748`.

Before this work concluded, #182 advanced seven commits to `be38e48c447ad19a4b50cddd29c8747e5da80811`.

The seven commits are visual/communicative Home/Marketplace work. Changed files include Home/Marketplace presentation and visual regression coverage. They do not modify:

- `web/src/pages/GuestSell.tsx`
- `web/src/pages/dashboard/owner/SellVehicle.tsx`
- `web/src/data/vehicleTaxonomy.ts`

`web/src/pages/Marketplace.tsx` did move, so the S0-critical filter constants were re-read at the new exact head.

## Revalidated S0 facts at #182 `be38e48c…`

Confirmed unchanged:

- taxonomy version: `carup-vehicle-taxonomy-1.0.0`;
- taxonomy inventory: 43 makes / 212 model entries;
- Guest fuel: Petrol, Diesel, Hybrid, Electric, Plug-in Hybrid, Other;
- Marketplace direct fuel: Petrol, Diesel, Hybrid, Electric;
- Guest transmission: Automatic, Manual, CVT, Other;
- Marketplace direct transmission: Automatic, Manual;
- Guest year rule: 1900 through current year + 1;
- authenticated Seller year list: 60 generated values;
- authenticated Seller default: `year: '2020'`;
- Marketplace year list remains separately generated.

The remaining persistence findings are anchored to the #182 backend/Seller contract and must be re-read again immediately before runtime mutation.

## Ownership decision

No Seller runtime source was changed.

Reason:

1. PR #181 freezes a maximum of two active source-write lanes.
2. #182 owns Seller/taxonomy/Marketplace files.
3. #183 owns Communications implementation.
4. #185 owns Intelligence implementation.
5. A new Seller runtime lane from stale `main` would create predictable shared-file conflicts and contract forks.

## Next legal action

Continue S0 contract/schema/test design in PR #186.

Before first runtime S0 commit:

1. re-read live main and all active PR heads;
2. determine which implementation lanes have merged/closed;
3. choose an accepted canonical base incorporating #182 or an explicitly reconciled descendant;
4. compare Seller target files against #183/#185 integration seams;
5. run merge-tree/shared-file conflict analysis;
6. only then authorize the S0 runtime implementation lane.

This receipt is evidence that live-head drift was detected and handled rather than ignored.
