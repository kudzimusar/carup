# One CarUp — Open PR disposition at RC1

**Source RC:** `integration/one-carup-source-rc1`. The lineage is linear from `main` `bb9d9900`; it contains no merges, sits 0 commits behind `main`, and every phase head is pushed and CI-proven.

**Rule applied:** no PR was merged wholesale. Each PR was reconciled against this lineage, and only its valid, unique remainder was implemented, in priority order:

1. Identity / People / Compliance
2. Seller
3. Garage / Mechanic / Service Network
4. Marketplace reliability
5. Trade OS remainder
6. Scenario infrastructure

## Categories

| Category | Meaning |
|---|---|
| **FULLY ABSORBED** | Everything valid in the PR is in RC1, by ancestry, patch-equivalence or a verified port. Closing the PR loses nothing. |
| **PARTIALLY ABSORBED** | Part of the PR is in RC1; the rest is listed under "Still required" or "Blocked". |
| **SUPERSEDED** | A later or better implementation on RC1 makes the PR's approach obsolete. |
| **STILL REQUIRED** | Valid, unique, and not yet in RC1. It needs a port. |
| **BLOCKED** | It cannot proceed without an owner decision, or it was parked by the moderator. |
| **DOCUMENTATION ONLY** | A plan, receipt or tracker; it is not a runtime change. |

## Summary

| PR | Title | Head | Disposition |
|---|---|---|---|
| #207 | Trade OS: full cross-border sourcing and shared-logistics expansion | `577428de` | **FULLY ABSORBED** |
| #214 | Trade OS phases 3–13 | `4ec68f7e` | **FULLY ABSORBED** |
| #218 | fix(vercel): make CarUp deployments release-only | `8253acc9` | **FULLY ABSORBED** |
| #211 | Scenario Lab: template ingestion and golden scenarios | `30393a71` | **FULLY ABSORBED** |
| #184 | docs(intelligence): Intelligence 1.0 canonical plan | `0ea51b58` | **FULLY ABSORBED** |
| #217 | AI-01-B: CarUp AI gateway + Cloudflare Gemma | `6c8ff6f7` | **FULLY ABSORBED** (runtime) |
| #215 | Trade OS phases 3–13 (alternate) | `deed00c7` | **SUPERSEDED** |
| #182 | Marketplace buyer↔seller reliability + reference UX | `cce3966c` | **SUPERSEDED** |
| #196 | docs(service-network): Foundation 1.0 plan | `be8706db` | **SUPERSEDED** |
| #208 | O2 People, Compliance, Identity & Onboarding | `e65c0bb8` | **PARTIALLY ABSORBED** |
| #209 | Garage & Mechanic Onboarding 1.0 | `ce45e16f` | **PARTIALLY ABSORBED** |
| #213 | Seller UAT remediation continuation | `ab9cc0e7` | **PARTIALLY ABSORBED** |
| #197 | Service Network Foundation 1.0 | `c23f012c` | **STILL REQUIRED** |
| #186 | docs(seller): Seller Journey 1.0 plan + S0 | `8697db38` | **DOCUMENTATION ONLY** |
| #219 | ci(vc-03): release-only CI | `db8bb088` | **BLOCKED** |

## Detail

### FULLY ABSORBED

- **#207** — The head is an ancestor of RC1.
- **#214** — The head is an ancestor of RC1.
- **#218** — `git cherry` shows its single commit as patch-equivalent: RC1 `b01ce7ef`.
  - `git.deploymentEnabled: false` in the root, web and backend `vercel.json`.
  - Pinned by `oc4d-release-only-deployments`.
- **#211** — The PR's own net diff was ported in `c7d08100`.
  - The port also fixes the PR's own failing test: `scenarioRunId` was never read from the scenario run.
  - The PR is stacked on #207's docs branch. Its other differing files are RC1's later evolution of #207 content, not missing #211 content.
- **#184** — Its documents landed verbatim in `4cd8cecc`; RC1's receipts already linked to them. Its files are identical to the PR head.
- **#217** — The runtime was converged in OC-3C, not merged:
  - one shared Cloudflare transport (`cloudflareAiTransport.js`) for the Qwen OCR policy and the Gemma gateway;
  - requests are byte-identical to the pre-convergence ones;
  - its 13 commits are reimplemented, not patch-equivalent.

  Not carried: the PR's plan document.

### SUPERSEDED

- **#215** — Two unique commits retire the legacy quote route. RC1 instead carries #214's guards on `assign-seller` and `addQuote`, which close the same gap. A tombstone is a product choice, not a remaining defect.
- **#182** — Superseded by RC1's marketplace reliability lineage (OC programme audit, 2026-10-03).
- **#196** — Its two plan documents travel in #197: one is identical, the other is updated. They will land with the Service Network port.

### PARTIALLY ABSORBED

#### #208 — O2 People, Compliance, Identity & Onboarding

**Already in RC1:**
- P1 (transfer supersession), via #194.
- X1 (Document Intelligence observes), converged in OC-2A.

**Ported in OC-4D:**

| Item | Commit | Notes |
|---|---|---|
| P2 | `8d6f497f` | |
| P3–P6, plus C2/C3/C8 | `5a6c24a9` | P6 closes the identity self-review hole that was live. P5 uses X6's privacy-corrected payload and registers its governed template. |
| Dealer authority (G/H/I/J/K/L/M rounds + predictive closure) | `981ab07b` | A live cross-tenant commerce and private-evidence defect. Extended to two surfaces that exist only on this lineage. |
| U1 | `75a032de` | |

**Still required, in this order:**
1. X3 — identity lifecycle and step-up.
2. X6 — `identity_assurance.v1`, plus the semantic events.
3. X2 — registration and progressive trust.
4. X5 — dealer onboarding.
5. U2 — Passport latency. It must be re-authored on RC1: as written it revives the retired trust writer and drops the registry-record guard.
6. U3 — goes with X5A.
7. Mobile-viewport polish.

**When porting:**
- `safeNarrationService`, `workbookSemanticMappingService` and `workbookAiAssistantService` import the retired `askGemini`. Re-point them to `domainAdvisoryAdapter`.
- Take none of #208's whole-file copies of `server.js`, `documentIntelligenceService.js`, `aiServiceBus.js` or `trustGraphService.js`.

**Blocked on the owner:**
- **X4** — biometric provider. The architecture-only port is possible.
- **X5A:**
  - whether to apply `20260908120000` (vehicle evidence upload idempotency);
  - whether a signed checksum stamp may coexist with RC1's hash-chained provenance authority.
- **Step-up UI** — #208's `StepUpDialog` or #209's `StepUpPrompt`.

**Re-certification:** all of #208's certification (P7, X7, mobile) has to be redone on RC1 as sibling gates. Its workflows hard-pin #208's ancestor SHAs.

#### #209 — Garage & Mechanic Onboarding 1.0

**Already in RC1:**
- GMO-1, via C3's bounded port. Its 19 tests are now carried (`eca2787c`).
- GMO-2 and the Qwen/DI work, superseded by C1–C3 and OC-3.

**Superseded inside the PR:** its O2 snapshot. That content comes from #208's head, never from #209.

**Still required:**
- **Service Network** — see #197.
- **GMO-3/4** — garage review and activation. Blocked on #208 X3/X6, which supply step-up and identity assurance.
- **GMO-5** — after Service Network.
- **GMO-6/7** — invitations and membership. These require fix **F1** first: invitation and membership services must require `tenants.type = 'garage'`, or any tenant admin becomes a generic membership authority.
- **Role catalogue `20260906220000`** — ships with the membership writers. No product path writes `tenant_users` today. Count the roles on staging and production before applying it.

**Migration timestamps to resolve:**
- `20260904180000`, `20260906090000`, `20260906120000` and `20260906150000` collide with RC1.
- The `150000` and `200000` files must be re-timestamped after `20261003100000`, which creates the garage tables.

#### #213 — Seller UAT remediation continuation

**Ported:**
- slice C — Communications test IDs (`02853cf6`);
- slice E — Landing `fixture_scope` (`33d7fe26`).

**Still required:**
- **A/B** — rollup@2 and migration `20260928133000`. Needs an ops recompute plan, a `kpiCatalogue` update, and an error check in `writeRollups`.
- **F** — rewrite as a sibling spec.

**Blocked:**
- **D** — owner sign-off, because it changes the production inquiry path.
- **Phase O** — owner decision on the Intelligence panels.
- **As-is:** its stale whole-file copies regress OwnerDashboard and SellerIntelligence, and it edits a certified gate.

### STILL REQUIRED

**#197 — Service Network Foundation 1.0.** Not in RC1. Port it from this head (which #209 contains), after these are resolved:

1. **Session tenant.** Converge on one rule: RC1's sole-membership rule (`tenant_role`), or #197's oldest-membership rule (`active_tenant_*`, which five web files read).
2. **Service history.** Keep `/api/service-history/me`'s shape, or fix the mobile garage screen. #197's reshape renders cost as an object and drops three fields.
3. **Migration timestamp.** Re-timestamp the O4 migration, which collides with `trade_os_rfq2`.
4. **Re-gating.** Apply GMO-5's `authorizeTenantRole` re-gating.

### DOCUMENTATION ONLY

**#186 — Seller Journey 1.0 plan and S0 receipts.**
- Its code is absorbed.
- Its documents are dated 2026-08-28 certifications, and nothing on RC1 links to them.
- They are not carried. Land them as history only if the owner wants them.

### BLOCKED

**#219 — VC-03 release-only CI.** Parked by moderator instruction for OC-4. It must not be absorbed without that instruction being lifted.
