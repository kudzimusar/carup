# Security Closure — G1, G2, G3

**Programme:** CarUp Intelligence 1.0 · **Lane:** `feat/carup-intelligence-1-0` (PR #185)
**Exact head at closure:** `96eccff2f0065a431e886f6a11eb5fcef460c95a`
**Accepted prior state:** I0–I6 at `bf4e1d8d0b6642f450a5e653b1528fd2fa5dd915` (not redone, not discarded)
**Status:** all three gaps closed, tested, and proven live. I7 was held for this and is now unblocked.

---

## What was wrong

Three pre-existing holes, all surfaced by the Intelligence I0 audit and all outside this programme's own code. Each let a caller author or read state that was not theirs.

| Gap | Severity | Defect |
|---|---|---|
| **G1** | P0 | `POST /api/referrals/events` was unauthenticated **and** unconstrained. Any caller could insert an arbitrary `event_type` against any tenant, attribute it to any user via `x-user-id`/`x-actor-type`, and backdate it — making the entire referral/attribution ledger forgeable. |
| **G2** | P1 | `GET /api/organizations/:id/users` had **no auth middleware at all** and returned every staff member's name, email and avatar for any organization id: a company's employee directory, enumerable by anyone. |
| **G3** | P1 | Seven referral operator listings preferred `req.query.tenant_id` over the verified tenant, behind a role list that includes plain `dealer`. Worse, a non-admin with **no** verified tenant fell through to `undefined`, which removed the filter entirely and returned **every tenant's rows**. |

---

## G1 — a constrained, server-derived contract

The moderator's requirement was to *preserve legitimately anonymous referral behaviour* while making forgery impossible. Anonymous reporting is genuinely valuable — a visitor opening a shared link or scanning a QR code is precisely the signal the referral programme exists to measure — so the route was constrained rather than removed.

Every consequential field is now derived on the server:

- **Event type** must be one of three public types (`referral.link_opened`, `referral.qr_scanned`, `referral.barcode_scanned`). Nothing that asserts a reward, a business outcome, or another party's state.
- **`tenant_id`, `code_id`, `campaign_id`** come from the referral **code row**, looked up server-side. A caller can name a code; it cannot name a tenant.
- **Actor** comes from a verified session or is anonymous. A new `buildVerifiedActorContext` ignores `x-user-id`, `x-stakeholder-role`, `x-tenant-id` and `x-actor-type` entirely, and also refuses an identity marked `identityAsserted` (the spoofable `x-user-id` fallback).
- **`occurred_at`** is the server clock — activity cannot be backdated.
- **Metadata** is a short allowlist of bounded codes, not free text.
- The route is **rate-limited** per IP (30/min), and the unconstrained `recordReferralEvent` is no longer reachable publicly. All 41 internal callers of it are unchanged.

One honesty correction made along the way: an anonymous report is recorded as `actor_type: 'user'` with a null id, **not** `'system'`. The column's CHECK offers no `anonymous` value, and `system` would falsely claim CarUp generated the event.

## G2 — membership required, fields minimized

The route now requires an authenticated **platform admin or a verified member of the organization's tenant**, reusing the membership proof `/audit-logs` already performed — extracted into one `assertOrganizationMembership` helper so the three organization routes share a single rule rather than three near-copies.

The projection is minimized: **email is no longer returned**, and the `select('*')` is gone so the route cannot silently republish whatever the table gains next. The sibling `/branches` route was the same class (unauthenticated organization records, including addresses) and is closed the same way. Neither route has any frontend consumer, so hardening them costs nothing.

## G3 — verified scope wins, always

One `resolveOperatorTenantScope` now governs all seven sites:

- a **platform admin** may pass `tenant_id` to **narrow** to one tenant, or omit it for a platform-wide view — that is their remit;
- **everyone else** gets their verified session tenant, and the query string is **not read at all** on that path;
- a non-admin with **no** verified tenant is **refused** (`403`) rather than falling through to an unfiltered read.

`/trust/disputes` likewise no longer lets a non-admin read another user's disputes by naming them: `user_id` is honoured only for platform admins and is otherwise forced to the caller's own id.

`OPERATOR_ROLES` deliberately remains broad (it includes `dealer`, `seller`, `agent`…) — a test pins that, because the breadth of the gate is exactly why the boundary has to hold in code rather than in the role list.

---

## Evidence

### Focused tests — 24/24 pass
`backend/tests/security-closure-g1-g2-g3.test.js`, written against the **properties** rather than the wording: forged headers ignored; asserted identity refused; the public allowlist covering link/QR/barcode and excluding wallet/coupon/campaign types; privileged and made-up types refused with nothing written; tenant/code/campaign taken from the code row while hostile claims are present; backdating refused; unknown and missing codes producing no event; a verified session attributed to the *real* user; metadata bounded so no contact detail reaches the ledger; out-of-vocabulary channel rejected; route rate-limited and no longer reading `x-actor-type`; G2 auth + membership + minimized projection + branches; G3 no remaining caller-first tenant pattern, all seven sites through the resolver, fail-closed for a tenant-less non-admin, admin-narrow-only, and the disputes user scope.

### Full backend regression — 4,539 tests, 0 failures
Under the `ci.yml` env contract. 4,518 pass, 21 pre-existing skips.

### Live proof against the deployed preview
`carup-backend-staging-git-feat-carup-intelligence-1-0-11-11.vercel.app`:

**G2** — the staff endpoint went from **`200` (leaking name/email/avatar) to `401`**:

| Request | Before | Now |
|---|---|---|
| `GET /api/organizations/org-1/users` unauthenticated | 200 | **401** |
| `GET /api/organizations/org-1/branches` unauthenticated | 200 | **401** |
| Same, with forged `x-user-id` + `x-stakeholder-role: admin` + `x-tenant-id` | 200 | **401** |

**G1** — the allowlist rejects privileged types with no identity headers involved, so it is the allowlist doing the work rather than CSRF:

```
wallet.transaction_created  → "event_type is not publicly reportable."
referral.i_won_a_reward     → "event_type is not publicly reportable."
referral.link_opened, no code → "code is required."
```

And the legitimate anonymous path still works, with **every hostile claim overridden**. Posting `link_opened` with a real staging code plus forged `tenant_id`, `code_id`, `campaign_id`, `actor_user_id`, `occurred_at` and a smuggled email stored:

| Caller claimed | Actually stored |
|---|---|
| `tenant_id: "tenant-victim"` | **`"platform"`** — from the code row |
| `code_id: "code-someone-elses"` | **`af3d881e-…`** — the looked-up code |
| `campaign_id: "campaign-someone-elses"` | **`61cdb1ad-…`** — the code's real campaign |
| `actor_user_id: "victim-user"` | **`null`** — anonymous stays anonymous |
| `occurred_at: "2020-01-01T00:00:00Z"` | **`2026-08-27T10:06:56Z`** — server clock |
| `metadata.note: "alice@example.com"` | **dropped** — only `{surface: "listing_card"}` |
| — | `actor_type: "user"`, not `"system"` |

The probe event was deleted afterwards; `referral_events` carries no residue from this closure.

---

## Residual disposition

**P2 — `private_key_pem` stored in the `public_keys` table** (`backend/services/blockchain/blockchainService.js`) remains open and is explicitly a **pre-merge security disposition**, per the moderator. It is not touched by this closure: it is a key-management change with its own blast radius (the signing ledger has 23 rows on staging and **716 in production**), and it warrants its own reviewed remediation rather than being folded into a referral/organization boundary fix.

**Also noted, unchanged:** the pre-existing `/api/admin/marketplace/analytics` is gated `['admin','government']`, handing an institutional role platform-wide commercial data. Intelligence's own admin projection deliberately excludes `government` (gap G5, closed for this programme in I5), but that legacy endpoint belongs to the marketplace lane.

---

## Gate statement

G1, G2 and G3 are closed at exact head `96eccff2`, with authentication, tenant-isolation and referral-boundary regressions pinned by 24 focused tests, a clean full-suite run, and live attack evidence showing each vector refused while legitimate anonymous behaviour is preserved.

**I7 (Seller/Owner Intelligence surfaces) is unblocked and resumes next.**
