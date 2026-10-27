# T11-CAP-LR01-R3 — Step J (responsive + accessibility) and the exact-head UAT candidate

Authority: [T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md](../T11_CAP_LR01_R3_WORKSPACE_NAVIGATION_VEHICLE_CAPABILITY_AUTHORITY.md) §30-J/K, §21 (AUTH-05 as applied by the Moderator), under the Moderator's release of implementation (D-1…D-4).
PR: **#244** (Draft; base `feat/trade-os-t11-cap-lr01-journey-arrival` @ `f4b12b60`; PR #243 untouched). Product code: last non-test commit `411ba2bd`.
**No migration. Production not accessed. Canonical staging Garage `8353dbdd` not touched, not aliased, not promoted.**

## 1. Result

| Gate | Proved by |
|---|---|
| Step J — 390 / 768 / 1280 / 1920: no sideways overflow, the active workspace on screen, breadcrumbs usable, touch targets, visible keyboard focus, logical tab order, no clipped identifiers | §2 — a deterministic Playwright spec: **42 tests pass on the product lineage and 42 on the runtime lineage's UI** |
| A new exact-head integration candidate (runtime lineage + the exact R3 product), runtime-only changes attributable, both SHAs nameable, canonical not mutated | §3 — candidate `2f192631`, paired Preview deployed, pairing proved from the served build and from the backend's own health |
| CI classified live, inherited reds separated from new | §5 |

## 2. Step J — the workspace layer, in a real browser

`web/e2e/r3-workspace-navigation.spec.ts` (mocked API, real Chromium, real debounce). 42 tests: **8 surfaces × 4 widths** (My Garage, Vehicle Passport, My Listings, Seller Studio, Import Orders, Import Order, Journey & arrival, Documents & evidence); **4** Seller-Studio-is-a-read tests; **6** explicit-control journeys.

| Property | How it is asserted |
|---|---|
| The page never overflows sideways | document width ≤ viewport; no element past the viewport edge unless inside an intentional scroller |
| The active workspace is on screen | the bar says which workspace is current, and that item has a box inside the viewport, ≥ 44px tall |
| Breadcrumbs stay usable | every crumb has a box ≥ 24px tall inside the viewport; exactly one `aria-current="page"` |
| Targets are touchable | workspace-bar links and the way up ≥ 44px |
| Keyboard | every control of the layer is reached by Tab, **in the order the page presents them**, none uses a positive tabindex, each shows a visible indicator (a ring with a colour — a transparent outline does not count) |
| Assistive technology | axe `wcag2a/wcag2aa`: **no serious/critical violation** in the workspace layer, the capability panel or the Garage cells, except the brand orange (below) |
| No clipped identifiers | a frame number and a deliberately 60-character model name are never ellipsised or clipped |
| Seller Studio is a read | the Serena and the Vezel, opened and left alone for two full debounces, send **zero** PATCH; the account-draft banner is the positive control; a real edit sends exactly one; an edit undone before the pause sends none |
| No browser Back | Garage → Passport → CAP → Passport → Studio → Passport, and Import Orders → Order → CAP → Order → Documents → Order → Import Orders, at 390 and 1280; the Serena is never offered a journey |

**Accessibility findings (real, found by axe, fixed where R3 owns the element).** Breadcrumb ancestors were `slate-400` on white (2.56:1) → `slate-600`; the 10px label token and the Garage/Listings labels of the same family were `slate-400` → `slate-500` (4.78:1) so a card is one shade. **Left as designed and reported: the brand orange** (`orange-600`, #ea580c) as small text (the Seller header eyebrow) and as a button fill under white text is 3.4:1, short of the 4.5:1 AA asks of small text. It is the Seller language's own accent, used app-wide; changing it is a design-token decision for the whole product (the repo's Command Center spec records the same class of residual), so the spec reports the count and does not fail on it.

**Negative controls** (each mutant applied to the shipped code, the spec re-run): the autosave guard removed, breadcrumbs unable to wrap, the way up shrunk below a touch target, a 640px workspace bar, breadcrumb colour back to `slate-400`, a positive tabindex, a wrong parent address, and a suppressed focus indicator → **8 of 9 killed**. The ninth (removing the custom focus ring) is **equivalent**: the browser's native ring remains, so focus is still visible. One check was found **vacuous by its own negative control** — Tailwind's `outline-none` is a 2px *transparent* outline, which a naive "has an outline" test counted as visible — and was fixed.

*What Step J does not prove:* the fixtures are synthetic. It proves layout and interaction, not data; the same pages on the real Kingston rows are Step K.

## 3. The UAT candidate

| | |
|---|---|
| Branch | `cert/t11-cap-lr01-r3-uat-candidate` |
| Candidate SHA | `2f192631` (deployed, paired) |
| Lineage | runtime canonical `8353dbdd` + R1 + R2 (`e28cbf25`, the R2 UAT candidate) + the R3 product |
| R3 product merged | `411ba2bd` then `d0f7c8c7` (a test-only tolerance); later PR commits are docs, CI-config and e2e-only |
| Backend Preview | `https://carup-backend-staging-ipmuwu1uc-11-11.vercel.app` — `dpl_ERzdYNwiMkYY3PVznw5ELiB7hJvu`, Preview target, no alias moved |
| Web Preview | `https://carup-staging-p7bkrdj7f-11-11.vercel.app` — `dpl_J2sALFbkMVpR4b1bsSSkYhDA1cDK`, Preview target, no alias moved |

**Pairing proved twice.** The web build's own `/carup-provenance.json` says `commit_sha 2f192631…`, `api_base_url https://carup-backend-staging-ipmuwu1uc-11-11.vercel.app/api`, `api_base_source "explicit VITE_API_URL"`, `unpaired false`; the backend's `/api/health` says `commit_sha 2f192631…`, `environment preview`, `source explicit_build_input`, `supabase_project_ref eoyenigwevnxwwhyhaer` (staging, `consistent true`), and **`communications.outbound.external_sends: disabled`** (the kill switch is on), so a UAT click cannot send a real message.

**Conflicts (four) and runtime-only adaptations (two commits), all attributable.** The runtime lineage also changes four files R3 changes. Each was resolved as a union and recorded in the merge commit `bf7445d1`:

| File | Resolution |
|---|---|
| `TradeOSWorkspaceLayout.tsx` | imports unioned: the runtime's `ActiveOrganisationPrompt` **and** R3's workspace bar and contexts |
| `MyGarage.tsx` | R3 retires `publicationLabel()`; the runtime's one-line reword of its `'publishable'` label goes with the function |
| `VehicleProfile.tsx` | R3's header and capability panel replace the four static buttons; the runtime's accessible name (page label **and** title, OC-5R-REL-02) is kept |
| `DiasporaOrderPassport.tsx` | R3's "order details" wording with the runtime's returnTo-preserving Sign in link |

Then two adaptations on top (`2ea3bc12`, `2f192631`): the `Link` import the runtime's "not in your garage" page still needs (R3 had dropped it with the static buttons), and — the one with consequences — **the capability panel keeps the runtime's R7 fail-closed ownership rule**. R7 renders a management control on `/dashboard/garage/:vin` only once ownership is *confirmed*; while the scope read is loading or failed none renders. The panel routes into Seller Studio and the import journey, so on this lineage it is held to the same rule (on top of the server, which sends `capabilities` only to the vehicle's own owner or seller). Two runtime-lineage tests that pinned the old structure were adapted and each says why: the owned vehicle's way into the Studio is now the panel's Marketplace action, and the heading and VIN now read inside the workspace header.

**Inclusion proof (R3 product ⊂ candidate).** Of the 77 non-test, non-document product files R3 changed against the R2 head, **69 are byte-identical in the candidate**; the other 8 are runtime-owned files (`backend/server.js`, the Trade shell, Communications, My Listings, Seller Studio, the Passport, Order details, `types/index.ts`) where **228 of the 230 non-blank lines R3 added are present verbatim**; the two that are not are exactly the two adaptations above (the `Link` import, and the panel wrapped by the R7 gate).

## 4. Candidate regression

| Check | Result |
|---|---|
| Web, whole suite | **311 files / 3,391 tests pass** |
| Types | `tsc --noEmit -p tsconfig.app.json` exit 0 |
| The R3 spec on the runtime lineage's UI (mocked API) | **42 pass** — the runtime's organisation switcher and compact bottom navigation do not break the layer at 390px |
| Backend — the R3 and CAP tests | 173 / 173 pass |
| Backend — whole suite, from the repo root as CI runs it, six watchdog shards | **646 files, 9,819 tests: 9,770 pass, 1 fail, 9 cancelled, 39 skipped** — every non-pass is inherited (below) |

**Inherited on this lineage, each proved identical on the pristine R2 candidate `e28cbf25` (not R3):**

* `garage-ops03-migrations.test.js` — *future confirmed appointments block silent OPS01 site/workforce deactivation*: it confirms an appointment at `2026-10-26T14:00:00Z`, which was in the future yesterday and is in the past today. A calendar-expired fixture of the same class.
* `oc5r-prov01-fx-observation-policy.test.js` — 9 tests **cancelled** (`Promise resolution is still pending but the event loop has already resolved`), 0 pass on `e28cbf25` too.

*Not on this list, on purpose:* the T3 *SAILING MATCH* test (`diaspora-logistics-rfq.test.js`) **passes 18/18 on the candidate and on `e28cbf25`** — the runtime lineage already carries the OC-4F fix that made its dates relative. It fails only on the product lineage (fixture date `2026-10-01` has passed), which is why it is red in CI for PR #244 and not here.

**A harness trap, recorded.** My first sharded run `cd`'d into `backend/` and produced 20 phantom failures (`Cannot find module '<repo>/backend/scripts/ci/…'`) in three CI-gate test files that resolve repo-root-relative paths. CI runs `node --test backend/tests/*.test.js` from the **repo root**; the same files fail identically on the pristine candidate and on the product lineage, which is how it was recognised as the harness. The run above is the corrected one.

## 5. CI classification — PR #244 at `f3d82c05`, live

| Check | Result | Class |
|---|---|---|
| `Bootstrap`, `Aggregate` (Diaspora Deployed Staging UAT) | fail — `UNGOVERNED_BRANCH` ("This branch has no governed preview pair") | **inherited**: the gate fails, never skips, a branch with no governed pair; identical on PR #243 |
| `backend-and-build` | fail — 1 of 1,458 tests: *SAILING MATCH* | **inherited**: also fails on the R2 product code `6c13fdc4` (run locally); the failing step ends the job, so its later steps do not run — tsc, the route check and the build were run locally and pass |
| `Passport foundation contracts` | **fail at `411ba2bd`, pass at `f3d82c05`** | **mine, fixed**: `git diff --check` flagged the trailing spaces that are the verbatim R3 authority document's markdown line breaks; R2's custody rule (`.gitattributes`, one file) now covers it too |
| `communication-unit`, `communication-postgres`, `playwright`, `referral-ci`, `staging-integration` | pass | — |
| `Chromium`, `Mobile`, `Tablet` | skipped | dependents of `Bootstrap` |

## 6. Preflight for the physical UAT

Fresh fingerprints were read (SELECT only, `md5(row_to_json(t)::text)`) at `2026-10-27T09:30:10Z`, before the candidate was deployed: **Serena `e9d216b9ca1eb39440d9be8ab39123e6`** (intact), **Vezel `308677ddad1c6ec206229e9060ff2352`** (unchanged since the audit), the Vezel's order `4714abd7b98bd752e093ee02f71a7f59`, 370 vehicles, 221 orders, Serena 10 listing images, Vezel 0.

ND-8 (a browser's crash-recovery copy of one vehicle shadows another's account draft) is handled in the protocol: the Studio's four browser keys are cleared before each Studio is opened and the account-draft banner is asserted as the positive control, so a "no PATCH" can never be vacuous.

## 7. Not yet done

Step K — the physical UAT as the real Kingston account on this pair: the Serena and Vezel paths, the Studio zero-PATCH proof on the real rows with the fingerprints read before and after, the four widths, console and network, then the final return.
