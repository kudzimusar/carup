# GMO-5 — Context & Portal Handoff · RECEIPT

**Status: PASS — after finding, and fixing, a critical vulnerability I introduced.**

This phase found a real architectural conflict, produced a wrong fix that passed every existing
test, had that fix demolished by an adversarial review, and shipped a correct one. The wrong fix is
documented here in full, because the reason it passed matters more than the fix itself.

---

## 1. The conflict PO-1 created

GMO-4 makes the founder platform `owner` with `tenant_users.role = 'admin'`. That person could not
open the garage they had just been given:

```
asserting the tenant role  ->  resolveEffectiveRole THROWS
                               ("requested === trustedTenantRole && requested !== 'admin'")
asserting nothing          ->  effective role stays 'owner', which no garage route lists
```

A garage *mechanic* never hit this, because `mechanic` is assumable. **`admin` is the one tenant role
that is not** — so PO-1's choice landed precisely on the case the mechanism could not serve. Proven
empirically before any code was changed, not inferred from reading.

## 2. The wrong fix, and why every test passed

I made the route gate accept any verified tenant membership in a role the route already lists —
globally, in `authorizeRole`.

It passed **6,320 backend tests and all 1,770 web tests.**

An adversarial review then executed a working exploit against the real router:

```
session token alone                       -> 403
+ x-tenant-id: <her own garage>           -> 200, the ENTIRE CarUp user table
POST /api/users/<real admin>/suspend      -> 200, the platform administrator's role is now 'suspended'
```

**The cause: namespace collapse.** `tenant_users.role` is unconstrained TEXT in which `'admin'`
means *administrator of this garage*. `users.role` is the platform vocabulary in which `'admin'`
means *a CarUp administrator*. 168 route registrations list `'admin'` in the second sense, and
`adminRoutes.js` gates on it alone with no capability check and no second gate. The gate could not
tell the two apart, so it treated the first as the second.

The `requested !== 'admin'` guard existed for exactly this. I did not weaken it — I routed around it.

**17 findings confirmed, 6 critical**, including real-money escrow release, global feature-flag kill
switches, government data-source operations, and the platform finance book.

### Why my own tests could not see it

My test re-implemented the gate as a local helper and **only ever called it with
`allowed: GARAGE_ROLES`** — a list that already contains `'admin'`. Its negative cases varied the
*tenant* role while holding the allow-list fixed. The breaking shape, `allowed: ['admin']`, was
never constructed. The suite therefore certified "nothing about platform admin moved" while the
platform-admin gate was the exact thing that had moved.

This is the same failure class as the GMO-4 `FOR UPDATE` mutation that stayed green: a check that
could not see what it claimed to see.

## 3. The correct fix

The tenant disjunct is **opt-in per route**, default off:

```js
authorizeRole(allowedRoles, { allowTenantMembership = false })
authorizeTenantRole(roles)   // proven session + tenant-scoped role list
```

Enabled on exactly six routers, enumerated in a test so a new file joining the set is a deliberate
decision rather than a default that spreads:

```
garageDirectoryRoutes · garageInvitationRoutes · garageQueueRoutes
serviceCaseRoutes · serviceRecordRoutes · serviceWorkOrderRoutes
```

`effectiveRole`, `role` and `platformRole` are untouched, so a tenant admin still never becomes a
CarUp admin, and Operations capability still derives from `platformRole`.

**The test that caught GMO-6.** When `garageInvitationRoutes.js` legitimately joined the opt-in set,
the enumeration test went red and demanded the decision be recorded. That is the mechanism working.

## 4. The second critical: my own tables had no RLS

All four GMO tables shipped with **RLS disabled**, while every comparable table around them
(`tenants`, `tenant_users`, `users`, `service_cases`, `dealer_compliance_documents`) has it enabled.
Without RLS, PostgREST exposes a table directly to `anon` — **the row deciding who becomes a garage
administrator was writable from a browser**, bypassing the reviewer, the capability check and the
step-up that three phases spend their effort enforcing.

Fixed: RLS `ENABLE` + `FORCE` on all four, `REVOKE ALL` from `anon`/`authenticated`, and the
activation function revoked from `PUBLIC`/`anon`/`authenticated` so PostgREST's RPC endpoint cannot
reach it either. Verified by reading the live catalogue back: all four now `rls_on=true`,
`rls_forced=true`, no anon privileges.

## 5. What GMO-5 actually delivers

- **`GET /api/auth/my-memberships`** — every organization the caller belongs to. `resolveActiveMembership`
  picks ONE at login (`limit(1)`, oldest first), which left a founder approved mid-session with no
  context until re-login, and made PO-6's second garage permanently unreachable.
- **`switch-role` now returns `active_tenant_role` and `active_tenant_name`** from the same verified
  membership row, so the handoff completes without logging out.
- **`GarageContextSwitcher`** — switches context *then* navigates. The activated panel used to render
  a plain `<a href="/garage">`, which lands on a 403. The GMO-1 test that asserted that link has been
  corrected, with the reason recorded in the test.
- **A failed membership read RAISES.** This codebase has already shipped the opposite once: a wrong
  column name made the query fail, the catch turned it into an empty list, and a real garage member
  was locked out by a fix that looked correct.
- **`canOperate` is the server's answer.** Belonging is not the same as being able to work.

## Evidence

| gate | result |
|---|---|
| `gmo-5-garage-context.test.js` | **27 / 27** |
| `garageContextSwitcher.test.tsx` | 13 / 13 |
| GMO 1–6 backend | **154 / 154** |
| Service Network parent (#197) | **289 / 289** |
| O2 parent (#208) | **198 / 199** — the known X7-4 lane guard |
| identity / dealer / operations | **145 / 145** |
| web suite (before the security fix) | 1770 / 1770 |
| live RLS catalogue readback | 4 / 4 tables locked |

## Mutation gates — all red, all reverted

| mutation | result |
|---|---|
| make the tenant disjunct global again (**the exact exploited state**) | **red** |
| default `allowTenantMembership` to true | **red** |
| make `authorizeSessionRole` opt in | **red** |
| switch `adminRoutes` to the tenant gate | **red** (2 tests) |

## What I take from this

The change was small, principled, well-commented, and passed 8,090 tests. It was also a critical
vulnerability. Two things would have caught it without an adversarial review, and both are now
permanent: **enumerate the blast radius of a shared gate** (168 call sites listed `'admin'`), and
**never assert on a re-implementation of the thing you changed** — my helper was a copy that could
not fail the way production could.
