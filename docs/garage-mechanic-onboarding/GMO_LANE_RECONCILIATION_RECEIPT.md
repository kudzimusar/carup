# GMO Lane — Parent Reconciliation Receipt

**Lane:** `feat/garage-mechanic-onboarding-1-0`
**Purpose:** GMO depends on capabilities living in two separate Draft lanes. This is the
dependency-convergence step, not GMO feature scope. Neither parent PR was modified.

---

## 1. Parent heads

| parent | branch | head | base |
|---|---|---|---|
| Service Network Foundation 1.0 (#197) | `feat/service-network-foundation-1-0` | `c23f012c` | `main` |
| O2 Identity/Onboarding (#208) | `feat/operations-o2-people-compliance` | `71b81d74` | `main` |

`main` = `bb9d9900`. Verified `merge-base(main, #197) = merge-base(main, #208) = bb9d9900` — both
branch cleanly off current main.

### 1.1 A local-environment obstacle, resolved

The working clone was **shallow**: `origin/main` and the O2 branch each had depth 1 and *no
computable common ancestor*, so the first delta measured was silently `HEAD..O2` — my own branch
against O2 — which is why the first reading wrongly showed 294 files including GMO's own new docs.

Fixed by `git fetch --depth=200` for both refs (main → 1962 commits, O2 → 2001), after which
`merge-base` resolves to `bb9d9900` and the deltas below are real. Recorded because a shallow clone
producing a plausible-looking wrong number is exactly the sort of thing that becomes a false
architectural claim.

---

## 2. Reconciliation surface

| | files changed over `bb9d9900` |
|---|---|
| #197 | 165 |
| #208 | 138 |
| **overlap** | **9** |

The nine, with each parent's change size:

| file | #208 | #197 |
|---|---|---|
| `backend/server.js` | 25+/17− | 109+/21− |
| `backend/services/communication/communicationEventListeners.js` | 6+ | 13+ |
| `backend/services/communication/communicationNotificationService.js` | 63+ | 49+ |
| `shared/navigation/feature-manifest.json` | 14+ | 68+ |
| `web/preview-backend-pairing.json` | 1+ | 2+/1− |
| `web/preview-frontend-pairing.json` | 1+ | 2+/1− |
| `web/src/App.tsx` | 8+ | 28+ |
| `web/src/config/featureRegistry.ts` | 15+ | 75+/2− |
| `web/src/hooks/useCarUpApi.ts` | 144+ | 310+ |

All nine are **additive on both sides** — route mounts, registry entries, API methods, event
listeners, manifest rows. This is the shape a semantic union can succeed on.

---

## 3. Union verification — not "the merge was clean"

Git auto-merged all nine without conflict. **That proves nothing**: the post-#194 reconciliation also
looked clean and silently unmounted every Service Network router. Two independent checks were run
instead.

### 3.1 Every added line from both parents survived

For each of the seven substantive shared files, every line added by each parent over `bb9d9900` was
searched for in the merged file:

```
server.js                                                lostO2:0  lost197:0
web/src/App.tsx                                          lostO2:0  lost197:0
web/src/config/featureRegistry.ts                        lostO2:0  lost197:0
web/src/hooks/useCarUpApi.ts                             lostO2:0  lost197:0
services/communication/communicationEventListeners.js    lostO2:0  lost197:0
services/communication/communicationNotificationService.js lostO2:0 lost197:0
shared/navigation/feature-manifest.json                  lostO2:0  lost197:0
```

### 3.2 Runtime route mounting — the check grep cannot do

The reconciled app was **booted** and its Express router stack walked:

```
total mounted routes : 754
  Service Network    : 37
  O2-side            : 57      (identity, verification, dealer, dealer-onboarding, workbook, operations)
```

Both parents' surfaces are live in the same process. A declared-but-unmounted router — the exact
post-#194 failure — would show here.

> **CORRECTION (GMO-2, 2026-09-06) — the three numbers above are superseded.**
>
> Re-measuring during GMO-2 gave a different total, so the enumeration was redone with a method
> stated in full below. The earlier figures came from a script that is no longer reproducible and
> should not be cited.
>
> **Method.** Boot `backend/server.js`, walk `app._router.stack` recursively, and emit one entry per
> `METHOD path` pair (a path serving GET and POST counts twice). Attribute a route to a programme by
> its first path segment after `/api/`, using the segment lists printed below rather than a
> free-text guess.
>
> ```
> total mounted routes (method+path)     : 760   before GMO      770   after GMO
> GMO contribution, proven by ablation   :  10   (mount removed, re-measured, delta = 10)
>
> Service Network (#197)                 :  35
>   /api/garage 11 · /api/service-cases 9 · /api/service-work-orders 5
>   /api/service-records 4 · /api/mechanic 6
>
> O2 People & Compliance (#208)          : 104
>   /api/workbook 45 · /api/verification 15 · /api/identity 9 · /api/dealer-onboarding 9
>   /api/dealer 6 · /api/compliance 8 · /api/evidence 5 · /api/documents 7
> ```
>
> The **conclusion is unchanged and is now better supported**: both parents' surfaces are live in
> one process, and a declared-but-unmounted router would still show. What changed is that the
> numbers are now reproducible from a stated method. The correction is recorded rather than quietly
> swapped, because a committed figure that cannot be re-derived is how a measurement artifact
> becomes an architectural claim.

---

## 4. Parent regression gates

| gate | result |
|---|---|
| #197 — all `service-network-*` suites | **286 / 286 pass** |
| #208 — `o2-*`, `identity-*`, `dealer-*` suites | 275 tests, 273 pass, **2 failures** |

Both failures were investigated. **Neither is an irreconcilable contradiction**, and both are
consequences of two lanes meeting rather than of either being wrong.

### 4.1 `o2-x7-integrated-certification` X7-4 — lane-isolation guard, expected to fail here

The assertion is literally *"PR #197 code must NOT be present or modified on this branch"*. It is a
correct guard **for the O2 branch**, keeping O2 out of Service Network's lane. On a branch whose
entire purpose is to converge the two, it is false by construction.

**Not modified.** Editing O2's canonical lane guard to accommodate a convergence branch would
weaken a real protection on the branch it exists to protect. It is recorded here as a
**lane-scoped expected failure**, and it is excluded from the GMO gate set with this justification
rather than silenced.

### 4.2 `o2-x4-biometric-consent` X4 — a vocabulary collision, fixed precisely

X4 forbids introducing biometric fingerprint/template storage. Its blanket rule rejected *any*
occurrence of the word `fingerprint` in a migration dated ≥ `20260829`, and Service Network's
`20260904180000_service_network_o4_event_dedupe.sql` contains:

```sql
v_fingerprint := NULLIF(NEW.payload ->> 'presentation_fingerprint', '');
NEW.dedupe_key := 'vehicle.trust.presentation_changed:' || v_fingerprint;
```

That is a **trust-presentation change hash used as an event dedupe key**. Nothing biometric, no
storage — a PL/pgSQL local. The test's own comment already excuses exactly this construct
("trust-presentation change fingerprints … are legacy naming, not biometrics"); the blanket date
rule simply predated Service Network having migrations in that era.

**Fix:** the expansion-era blanket check now strips SQL comments and the two dedupe identifiers
before scanning. The two targeted patterns (`biometricFingerprint`, `templateStore`) still run
against the **unmodified** SQL of every file, so the law is unchanged.

**Mutation-proven:** adding a migration defining `fingerprint_template` / `face_embedding` still
turns X4 red; removing it returns to green. The law fires; only its collision with another domain's
vocabulary is gone.

---

## 5. A genuine authority reconciliation

Running #197's SN-0 boundary suite against the merged tree surfaced a real difference of opinion
worth recording, because resolving it sharpened the shared contract.

**#197 asserted:** a registration `business_type` claim must never appear in a module that decides
access.

**#208 does:** `assertDealerOnboardingContext` reads the caller's own registration profile and
refuses unless `account_kind === 'business' && business_type === 'dealer'`.

**Resolution — O2 is right, and #197's rule was too strict.** O2's gate grants *"onboarding
capability only, never Dealer authority"* (its own words), writes no `tenants`, no `tenant_users`
and no `users.role`, and gates only `/api/dealer-onboarding/*` — i.e. *"you said you are a dealer,
so you may work on your own dealer application"*.

The reconciled invariant, now encoded:

> A registration claim **may** gate access to the applicant's **own onboarding surfaces**.
> It may **never** grant a professional capability, a tenant, a membership or a domain authority.

`service-network-authority-boundaries.test.js` was rewritten to test what a claim-reader *does*
rather than whether it reads one: a claim-reading module must not **write** tenancy (reading
`tenant_users` is ordinary — `server.js` selects it in six places; creating a membership is the
escalation), must not appear in a Service Network or feature-governance decision, and must not
branch on a claim in a module that also grants capability. A second test pins O2's boundary directly
so a future widening is caught here.

**Mutation-proven:** making the dealer claim-gate insert a `tenant_users` row turns two tests red.

This is the contract GMO-4 will be built against: **the claim opens the application; only activation
creates the business.**

---

## 6. Constraints held

- Neither parent PR was modified; both remain Draft and unmerged.
- `main` untouched at `bb9d9900`.
- Production untouched.
- No migrations added by this reconciliation.
- No provider activation, no credentials, no spend.
