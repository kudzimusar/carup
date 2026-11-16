# Service Network — Global Design, Mobile Navigation & Identity/Onboarding Convergence

**What this is.** The audit the Product Owner asked for after the Service Network transaction loop
passed UAT: does the package hold up under CarUp's newer global `DESIGN.md`, responsive navigation,
account-context, onboarding and OCR architecture — rather than merely against its own tests.

It found one **architectural gap that is a Product Owner decision**, one **seventh instance** of a
defect class this programme has now paid for eight times, and a set of design violations that were
never gated because the gate did not exist when the work was specified.

---

## 1. Was Service Network certified against the current root `DESIGN.md`?

**No. It could not have been.**

```
DESIGN.md ADDED               2026-09-04   merge bb9d9900 (PR #194)
Service Network lane opened   2026-08-29   001f7de2 — DESIGN.md absent at this commit
```

`git log --diff-filter=A -- DESIGN.md` returns exactly one commit, six days *after* the Service
Network lane opened. S0–S10 were specified and built against feature-local judgement, and the
package became functionally and responsively usable through owner UAT **without any global-design
gate ever running**.

`DESIGN.md` §24 requires a UI PR to state which sections it implements and forbids merging one that
knowingly introduces a legacy pattern. Nothing enforced either. A prose contract no test reads is a
contract the next agent will not know exists.

### The durable mechanism

`web/src/__tests__/designContract.test.ts` now enforces the mechanically decidable clauses, names
the clause in each failure, and fails if `DESIGN.md` is renamed or those clauses vanish:

| clause | enforced as |
|---|---|
| §4.3 | connected routes share one page container; none re-declares its own width |
| §6.2 | every detail surface carries a back/up affordance |
| §8.1 | no `?? 0` / `\|\| 0` display fallback — unknown is not zero |
| §10 | touch targets declared; no fixed width that forces page overflow |
| §20 | legacy `card-shadow` count per surface may shrink, never grow |
| §24 | every Service Network surface is declared to the gate; a new one fails until added |

Editorial judgement (§3 character, §4 palette/typography) stays a human review. A test should not
pretend to see it.

**§20 is a ratchet, not a cliff.** Nine working, UAT-passed pages are built on
`Card + CardContent + card-shadow`, which §20 deprecates — built before the rule existed. Rewriting
them to chase a visual standard is a redesign, and this was an audit. Their counts are recorded and
may only fall, which is exactly what §20 means by "existing legacy surfaces are migration targets".
The mechanism already worked once: making the KPI band a real band retired one card and the budget
came down 4 → 3 in the same commit.

### Page-by-page disposition

| surface | width | back/up | fake zeros | touch targets | legacy cards | disposition |
|---|---|---|---|---|---|---|
| GarageDirectory | canonical 1440 band | n/a (list) | none | ok | 3 | compliant |
| GarageDetail | canonical 1440 band | back to directory | none | ok | 6 | compliant |
| ServiceLink | centred card | action to `/` | none | ok | 1 | compliant |
| ServiceRequests (owner) | **converged** | dashboard shell | none | ok | 3 | fixed |
| ServiceHistory (owner) | 7xl | dashboard shell | none | ok | 5 | compliant |
| GarageWorkspace | **converged** | dashboard shell | none | ok | **3** (was 4) | fixed |
| GarageCaseDetail | **converged** + detail column | ← Workshop | none | ok | 8 | fixed |
| GarageCustomers | **converged** | ← Workshop | none | ok | 3 | fixed |
| GarageProfileEditor | **converged** + form column | ← Workshop | none | ok | 3 | fixed |

**§4.3 violation found and fixed:** the garage workflow used `max-w-5xl`, `max-w-3xl`, `max-w-3xl`
and `max-w-2xl` — a garage operator moving Workshop → job → Customers watched the content column
jump three times in one task. All five connected surfaces now share one container at the canonical
band, with forms keeping a deliberate reading measure *inside* it.

**§10 violation found and fixed:** the queue KPIs were `grid-cols-1 sm:grid-cols-3`, so on a phone
three numbers became three ~180px-tall stacked cards that pushed the actual work below the fold —
the desktop grid stretched down a phone, which §10 names as treating mobile as a shrunk desktop.

---

## 2. Mobile authenticated navigation

**Decision: extend the one canonical `CompactBottomNav` to the authenticated shell.**

Verified before changing anything, because the directive's expected principle had to be checked
against what CarUp actually does:

| finding | evidence |
|---|---|
| A canonical compact bar already existed | `web/src/components/layout/CompactBottomNav.tsx` |
| It was mounted **only** in the public shell | `MainLayout.tsx`; `DashboardLayout` had zero bottom-nav references |
| Web bottom tabs were **deliberately deferred** | Lane B.1, `docs/navigation-intelligence/NAVIGATION_PR_RECONCILIATION.md` |
| The **native** app already ships governed role-aware tabs | ≤5 ceiling, More→drawer, dedupe — `NATIVE_NAVIGATION_IMPLEMENTATION.md` |

So every authenticated workspace on a phone had a hamburger drawer and nothing else, while the
native app had the governed contract the directive describes. The right move was to bring the one
web component up to that contract — **not** `GarageBottomNav` / `MechanicBottomNav`, which would be
the competing systems that lane already rejected.

The bar now:

- resolves destinations from the **feature registry**, filtered by `resolveFeatureVisibility` — the
  same resolver the sidebar, drawer and route boundary use, so what it offers and what a route
  admits cannot disagree;
- follows the role the person is **operating** as (a bar states the current task, not an inventory
  of everything the person could ever do);
- holds ≤5 items with "More" opening the **existing** drawer — no second secondary surface;
- carries safe-area insets, ≥44px targets, exactly one `aria-current`, and page padding equal to its
  own height so it never covers a primary CTA;
- lost its private `ROLE_HOME` map — an eighth place deciding one fact;
- takes short labels from an optional registry field rather than a lookup of its own.

Desktop and tablet ≥1024px keep the sidebar (`lg:hidden`, verified as `display:none`).

---

## 3. Active-context authority

One canonical chain, now consumed identically everywhere:

| fact | authority |
|---|---|
| identity | session → `users.id` |
| platform role | `users.role` (public registration only ever creates `owner`) |
| profile **claim** | `user_registration_profiles.business_type` — **never** an authority |
| membership | `tenant_users` |
| tenant role | `tenant_users.role`, verified |
| operating context | active tenant carried on the session |

**The rule** — the platform role **OR** the verified tenant role satisfies a requirement — was
always stated in `resolveEffectiveRole`. Seven other layers had never been told. Six were found in
the previous tranche; this audit found the seventh:

> `getMobileNavigation` resolved role items from the platform role alone. A real garage
> tenant-member's mobile drawer showed **19 owner items, 0 garage items**, and a "Dashboard"
> pointing at the owner dashboard they had just been routed away from.

Desktop had been fixed; the drawer had not. Navigation visibility and route admission are meant to
be one decision, and on mobile they were two.

---

## 4. Registration → account access

Registration is **correct and truthful**, and grants nothing:

| account | selects | stored | granted immediately | pending |
|---|---|---|---|---|
| individual (buy/sell/owner) | account kind, market, intended use | profile, `onboarding_status: not_required` | full owner portal | nothing |
| business — dealer/garage/mechanic/importer/exporter/parts/insurer/lender/other | + organisation name, business type | profile, `onboarding_status: requested` | **owner portal only** | business review |
| diaspora | market relationship `diaspora` | profile | owner portal | as above if business |

The registration screen states it plainly: *"Dealer, exporter and other professional permissions are
granted only after governed business review. Signup itself does not grant those privileges."*
`registrationProfileService` touches no role, tenant or membership, and its vocabulary is a frozen
closed list.

---

## 5. O2 ↔ Service Network — the gap

**The chain is broken at exactly one link, and closing it is a Product Owner decision.**

```
registration ✓ → registration profile ✓ → identity/business onboarding ✓
   → governed membership ✗ ← NOTHING IN THE PRODUCT CREATES THIS
   → active context ✓ → SN navigation ✓ → route ✓ → backend capability ✓
```

Verified by exhaustive search at this head:

```
inserts into tenant_users : NONE in production code
inserts into tenants      : NONE in production code
onboarding_status writes  : ONE — set at registration ('requested' | 'not_required')
transitions to in_review / approved / rejected : NONE
```

Every `tenant_users` reference is a read. `dealerComplianceService` manages profiles, branches,
requirements and documents and never writes `tenants`, `tenant_users` or `users.role`. No admin
route, RPC or onboarding path creates either, and nothing can advance a business application past
`requested`.

**Consequences, stated plainly:**

- a real person registering as `business_type: garage` gets a correct, safe base account and **no
  path to ever operating a garage on CarUp**;
- Service Network's garage side is reachable only for memberships provisioned out of band;
- every garage used in Service Network certification was created by **direct SQL in fixtures**,
  never by a product journey;
- Journey B ends truthfully at "onboarding pending" — and stays there, because no reviewer action
  exists that could complete it.

**Nothing was invented.** Choosing who may grant a business/tenant membership, and on what evidence,
is a new authority that does not exist today. The directive lists exactly that as a stop condition,
and writing one would have been fabricating governance.

---

## 6. OCR boundary

**OCR is input assistance and grants nothing.** Verified structurally: no module under
`backend/services/identity/` writes `tenant_users`, `tenants`, `users.role` or `active_tenant_role`.
`documentClassifier` carries an explicit `extractionAllowed` / `extractionTrust` model
(`NOT_RUN`, `PARTIALLY_TRUSTED`, …) so provenance travels with candidate data.

Service Network consumes only the resulting governed identity/membership state, so it cannot tell —
and must not care — whether extraction was manual, mocked or provider-backed.

**Live OCR remains unactivated.** No provider was enabled, no credential added, no spend incurred.
It is pending cost-bearing provider certification in its own lane.

---

## 7. Evidence

**Exact head:** `3bcffbd73fac735c17d59ec8bca4890bd1b46dc3`
**Deployed pair:** frontend and backend both `3bcffbd7`, `unpaired: false`, preview paired to its own
branch backend from `preview-backend-pairing.json`.
**Browser result:** **31 PASS · 0 FAIL · 0 findings** across desktop 1440 / tablet 834 / mobile 390.

### Browser (desktop 1440 / tablet 834 / mobile 390)

Both deployments on the same commit, preview paired to its own branch backend, `unpaired: false`.

- garage staff land on `/garage` at all three widths;
- Workshop renders; no horizontal overflow at any width;
- compact bar **visible** below 1024px and `display:none` above it;
- bar context `mechanic`, items `Workshop | Jobs | Customers | More`, ≤5 with More;
- bar navigates, marks exactly one `aria-current`, More opens the existing drawer;
- at full scroll the bar buries **no** control (last element 772, bar 775, 72px padding applied);
- direct protected URL admitted identically to navigation;
- an account with **no governed membership** cannot reach `/garage` and is **not offered** a garage
  destination;
- owner bar shows the owner context on mobile.

### Suites

| suite | result |
|---|---|
| full backend | 6055 tests, **6034 pass, 0 fail**, 21 skipped |
| layout / registry / lib / garage / route convergence | **510 pass** |
| design contract gate | **10 pass** |
| SN-0 authority boundaries | **6 pass** |
| compact navigation | **10 pass** |
| typecheck (`web/tsconfig.app.json`) | clean |

### Mutations — all reverted

| # | mutation | caught by |
|---|---|---|
| 1 | remove a bottom-nav context mapping | compact nav suite |
| 2 | a bar that ignores who is asking (offers `/admin` to an owner) | nav↔route parity |
| 3 | mobile drawer back to platform-role-only | compact nav suite |
| 4 | `business_type` grants garage access | SN-0 boundaries |
| 5 | identity/OCR writes a tenant membership | SN-0 boundaries |
| 6 | a QR scan writes anything | SN-0 boundaries |
| 7 | a connected route re-declares its width (§4.3) | design gate |
| 8 | a page loses its back action (§6.2) | design gate |
| 9 | a fake zero appears (§8.1) | design gate |
| 10 | the legacy card budget grows (§20) | design gate |
| 11 | remove tenant membership from a mechanic | `tenantRoleAccess` control case |

### Measurement errors of my own, recorded

Two in this audit, both the same shape as the six in the previous tranche — *a check that could not
see what a person sees*:

- **"the bar covers content"** — compared viewport rects at scroll-top, which is true for any page
  taller than the viewport. Measured at full scroll: nothing buried. The product was right.
- **"the bar is present at desktop"** — counted DOM nodes, but `lg:hidden` is `display:none`, not
  removal. Verified: desktop `display=none visible=false`. The product was right.

Recorded rather than quietly corrected: a run that reports defects the product does not have is a
run whose passes deserve less trust.

---

## 8. Unresolved Product Owner decisions

1. **Business/tenant activation authority (blocking for a real garage journey).** Nothing in the
   product creates a `tenants` row, a `tenant_users` row, or advances `onboarding_status` past
   `requested`. Who may grant a membership, on what evidence, and through which surface, is an
   authority that does not exist and was not invented.
2. **Dealer activation** remains the pre-existing O2 gap; this audit did not close it and did not
   disturb it.
3. **Live OCR provider activation** remains cost-bearing and unapproved.
4. **§20 legacy migration.** Nine surfaces carry the deprecated card composition. The ratchet stops
   it worsening; a deliberate migration pass is a separate, ownable piece of work.
5. **Directory search/filter (F10 from Round 1)** remains product work, not connection work.
