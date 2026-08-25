# Issue #164 Phase 8 — Public Surface Convergence, Prototype Removal & Closure

Phase 8 makes every public and authenticated CarUp surface consume the **same canonical vehicle truth**
built in Phases 0–7, removes the remaining prototype/fabricated business facts, automates the fourteen
permanent invariants, and prepares PR #165 for final protected merge.

> **ONE VEHICLE. ONE TRUTH. ONE PUBLIC CONTRACT.**

## What the 8A inventory found

Three read-only inventories (Landing/Marketplace, Detail/Passport/Owner, mock/prototype audit) showed
that **Detail, Passport and the Owner list surfaces were already converged** by Phases 3–5: canonical
`toPublicTrust` everywhere, provenance-gated claims, listing-media/evidence separation, and no
browser-asserted transaction truth. The remaining divergence was narrower and specific:

| Surface | Defect found | Resolution |
|---|---|---|
| `VehicleProfile` (owner per-VIN) | Never received the Phase 3/4 treatment: fabricated **"AI Valuation" = `price × 0.9`**, Unsplash stock car, `purchaseDate: today`, a real company (`'Simbisa Garages'`) invented as the servicing garage, `'Unknown'`/`'OEM'`/`0` coercions | Rebuilt on `ownerStatedValues` + `ListingImage`; valuation section removed (CarUp publishes no valuation) |
| `VehicleDetail` | `currency ?? 'USD'` (×4); raw `registration_country`/`registration_authority` column fallbacks bypassing governed claims | `governedPrice()` (amount **and** recorded currency, else "Price not recorded"); governed `claims.registration` only |
| `Marketplace` | `'Petrol'`/`'Auto'` spec defaults; `'CarUp Dealer'`/`'Private seller'`/`'Private Owner'` seller fabrication; blanket *"verified vehicles across Zimbabwe"* | Specs render only when recorded; governed `seller_display_label` or "Seller not disclosed"; honest population copy |
| `Landing` | **100% mock inventory** with fabricated `isVerified` badges and `Trust {score}` numbers; search box and category chips discarded the user's query | Reads the canonical `/marketplace/listings` contract (this is what makes Invariant 13 real); governed tags only, no trust number; intent forwarded via `?q=` |
| `Navbar` | Mock notification list (including a fake "blockchain verification") shown to every visitor | Real `/notifications/me` + honest empty state |

## Fabricated business facts removed

Nothing was invented as a replacement and no surface was deleted; each renders an **honest empty or
unavailable state** wired to governed data where an API exists.

- **InsuranceDirectory** — listed **real** insurers (NicozDiamond, CABS, Cell Insurance) as CarUp-verified
  onboarded partners with ratings, contacts and *Get a Quote*.
- **DealerDirectory / GarageDirectory** — invented companies shown with green "Verified" badges.
- **AdminDashboard** — **real institutions** (Croco Motors, Simbisa, Old Mutual, CBZ Bank, ZIMRA) listed as
  Active partners with invented Trust Index percentages; fabricated fraud interceptions.
- **DealerDashboard** — mock-inventory fallback (an error is not an inventory), unlocated vehicles filed
  under Harare, fabricated leads/sales/revenue, a blanket "ZIMRA Cleared" badge on every row, hardcoded USD.
- **InsuranceDashboard** — fabricated policy/claim/premium/fraud figures, a hardcoded "98.7% fraud detection
  accuracy", invented claim history and policyholder rows.
- **PressKit** — three fabricated press releases (an official ZINARA registry integration, a parts-ledger
  partnership, a closed seed funding round) with invented executive quotes, plus fabricated scale metrics.
- **Blog** — a post claiming a deployed Decentralized Vehicle Registry "in partnership with major local
  insurers (such as NicozDiamond and Cell Insurance)" with "100% Tamper-Proof" verification.

## Blockchain → CarUp audit ledger

User-facing "blockchain" / "tamper-proof" / "decentralized" wording was reworded to describe the
hash-chain **audit ledger** CarUp actually operates, consistent with the precedent already recorded in
`Marketplace.tsx` ("part authenticity is tracked by CarUp audit ledger, not a public blockchain").
Affected: VehicleDetail, TrustSafety, PartSentry, AIDashboard, ServiceLogs, BankDashboard, About, PressKit.

## The fourteen permanent invariants

`backend/tests/issue164-phase8-permanent-invariants.test.js` — 23 behavioural tests driving the real
canonical contract functions. Two initially passed **vacuously** (a `require` call inside an ES module
made the directory walks silently return an empty list; INV-13 matched an import rather than a call);
both were fixed and now assert the mechanism. Mutation-verified: leaking `owner_id`, publishing drafts,
and repointing Landing off the canonical reader each turn their invariant red.

## PR #161 disposition

PR #161 (`feat/owner-dashboard-electric-redesign`) branched from a **pre-Phase-3/4** `main`. Merging it
would delete the canonical trust projection and reinstate raw-column truth, so it **must not be merged**.
It was inspected read-only and its valid work ported:

| Item | Disposition |
|---|---|
| `resolveApiBaseUrl` staging-host safety | **PORTED (P1)** — closed a real environment-isolation defect: with `VITE_API_URL` unset, the staging frontend sent credentials to the **production** backend |
| Owner top-bar search → `/search?q=` | **PORTED (P3)** |
| Owner notification bell | **PORT PENDING (P2)** — must be rewired to `/notifications/me`, not the Communications contract |
| "Needs Your Attention" rail / "Next Best Step" | **PORT PENDING (P4)** — minus every raw-`trust_score` read |
| `averageVehicleTrust`, trust dials/bars, saved-card trust chip | **DROP** — reads raw `vehicles.trust_score`; invents an averaged metric no authority publishes |
| `vehicle.location \|\| 'Zimbabwe'`, `mileage \|\| 0`, raw `<img>` stock fallback | **DROP** — fabricated defaults |
| Notification repointing to `/communications/notifications` | **SUPERSEDED** — canonical contract is `/notifications/me` |
| `owner-experience-staging-uat-fixture` script + workflow + SVGs | **DROP** — the old thin UAT fixture; writes raw `trust_score` 84/90/82 and Petrol/Automatic/Zimbabwe defaults. Superseded by the Phase 7 Golden Reference Vehicle Dataset |

## Golden Vehicle authenticated UAT — how identity works

CarUp does **not** use Supabase Auth for application login: there is no `auth.users` row and therefore
no Auth-UUID → application-user bridge to build. `users.id` **is** the application identity:

```
POST /api/auth/login
  → SELECT id, name, email, phone, role, password_hash FROM public.users WHERE email = ?
  → evaluateLoginCredentials({ user, password })        (backend/utils/passwordAuth.js)
       · password_hash present → verifyPassword(password, hash)   [scrypt]
       · otherwise            → { ok: false, reason: 'password_not_set' }   ← Golden users today
  → INSERT INTO public.user_sessions (real session token)
```

The Golden identities already exist; the only thing preventing a real session is an unset
`password_hash`. `backend/scripts/issue164-golden-uat-auth.mjs` therefore sets that hash on the
**existing** rows through the same governed `hashPassword` the registration path uses:

- preserves the Golden identities exactly (same ids, emails, roles) — no new identity, no bridge, no
  change to the Golden truth model;
- uses the real, unmodified login path — **no auth bypass, no `x-user-id`, no weakened credential check,
  no passwordless toggle**;
- staging-only (exact-host guard, production ref refused) and hard-pinned to the four synthetic accounts;
- the password comes from `GOLDEN_UAT_PASSWORD` and is never printed, persisted or committed;
- removable and idempotent: `--mode=revoke` clears the hash again.

Containment is tested in `backend/tests/issue164-phase8-golden-uat-auth.test.js`.
