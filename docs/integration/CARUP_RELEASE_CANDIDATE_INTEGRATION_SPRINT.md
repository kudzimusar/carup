# CarUp Release Candidate Integration Sprint

## Governing instruction

This document is the execution brief for bringing CarUp's isolated feature branches and preview deployments into one coherent, testable release candidate.

The goal is **not** to merge every open pull request blindly. The goal is to produce one stable integration branch and one stable staging environment where the current web, backend, mobile contracts, marketplace, navigation, verification, PartSentry, referral, and Diaspora work can be tested together.

---

## 1. Current problem statement

Manual testing of the stable staging frontend found that these Marketplace URLs did not behave as expected:

```text
https://carup-staging.vercel.app/marketplace?maxPrice=5000
https://carup-staging.vercel.app/marketplace?maxPrice=10000
https://carup-staging.vercel.app/marketplace?sort=trust
https://carup-staging.vercel.app/marketplace?q=Toyota
```

The UI appears to mix:

- old mock or fallback data,
- features already merged into `main`,
- isolated features deployed from other PR branches,
- staging-only data,
- and work that exists in open pull requests but is not present on `main`.

This means component-level and PR-preview testing has succeeded in places, but **system-level release-candidate testing is not yet complete**.

---

## 2. Current repository evidence

The repository currently has an open integration PR:

- PR #73 — `Marketplace v1 — production integration sprint (AI-governed trust marketplace)`
- Branch: `feature/marketplace-v1-production-integration`
- This PR is large and high-risk: it spans frontend, backend, mobile, database, tests, documentation, marketplace, moderation, referral, trust, and inquiry functionality.
- It must not be merged directly into `main` without a release-candidate integration cycle.

Other open PRs that may affect the integrated system include:

- PR #72 — verification review loop and mobile status refresh
- PR #66 — registry-driven mobile hamburger drawer
- PR #58 — Diaspora shipment by-id read-access hardening
- PR #11 — PartSentry public-card approval backend workflow

PR #73 already consumes or ports parts of these contracts, but it does not automatically prove that the complete branches work safely together.

---

## 3. Objective

Create a single release candidate that proves:

```text
one frontend
→ one backend
→ one staging database
→ one migration state
→ one feature registry
→ one navigation contract
→ one integrated test suite
→ one stable staging URL
```

The finished release candidate must allow the Product Owner to test the system as one product rather than as isolated PR previews.

---

## 4. Required environment model

From this sprint onward, use these environment roles:

### Pull-request previews

Purpose:

- isolated feature testing,
- code review,
- focused regression testing.

PR previews must not be treated as the integrated CarUp staging system.

### Stable staging

Purpose:

- release-candidate integration,
- end-to-end testing,
- cross-feature validation,
- manual Product Owner acceptance testing.

The stable `carup-staging` frontend and its staging backend must deploy from the designated release-candidate branch, not from unrelated feature branches.

### Production

Purpose:

- merged and approved releases only.

Do not write production data or change production infrastructure during this sprint.

---

## 5. Branch strategy

Create:

```text
release/carup-v1-rc1
```

from the latest `main`.

Do not work directly on `main`.

Do not merge PR #73 into `main`.

The release candidate branch should become the integration target for approved branches.

Preferred process:

1. Fetch and update the latest `main`.
2. Create `release/carup-v1-rc1`.
3. Reconcile PR #73 onto the release-candidate branch.
4. Resolve conflicts against current `main`.
5. Integrate other approved PRs only after dependency and overlap analysis.
6. Preserve commit and PR provenance.
7. Record every included, partially ported, superseded, or deferred PR.

---

## 6. Phase 0 — Read-only integration audit

Before modifying code, inspect:

- current `main`,
- current working tree,
- all open PRs,
- branch ancestry,
- changed-file overlap,
- database migrations,
- environment variables,
- Vercel project/branch configuration,
- frontend API base URLs,
- staging database contents,
- mock/fallback/fixture sources,
- existing E2E and integration tests.

Produce an integration matrix:

| PR / feature | Branch | Files/areas changed | Depends on | Conflicts with | Include / port / defer | Reason |
|---|---|---|---|---|---|---|

At minimum, include:

- PR #73
- PR #72
- PR #66
- PR #58
- PR #11
- merged Navigation Intelligence work
- current `main`

Also identify:

- features present only in previews,
- features present on `main`,
- features present only in staging data,
- mock UI still reachable,
- legacy API endpoints still used,
- duplicate or competing implementations.

Do not begin integration until this matrix is complete.

---

## 7. Phase 1 — Reconcile PR #73 as the integration spine

Use PR #73 as the initial Marketplace v1 integration spine, but treat it as untrusted until revalidated.

Required actions:

1. Bring PR #73 changes onto `release/carup-v1-rc1`.
2. Resolve conflicts against the latest `main`.
3. Confirm Navigation Intelligence changes remain intact.
4. Confirm the shared `VITE_API_URL` resolver remains intact.
5. Confirm existing production-safe fixture exclusion remains intact.
6. Confirm no old hardcoded production backend URLs are reintroduced.
7. Confirm no test-only authentication shortcut is enabled in production.
8. Confirm no unrelated application area is removed.
9. Review all 93 changed files by subsystem.
10. Produce a subsystem change summary before further integration.

Do not use “build passes” as proof of correctness.

---

## 8. Phase 2 — Reconcile open PR dependencies

For each open PR, make one explicit decision:

### Include

Merge or port the complete PR because it is required for RC acceptance and is compatible.

### Port

Bring only a documented, minimal subset because the full PR is not ready or duplicates PR #73.

### Defer

Leave it out of RC1 with a documented reason and user impact.

### Superseded

Document that PR #73 or another merged implementation fully replaces it.

Specific review requirements:

#### PR #11 — PartSentry approval workflow

Determine whether RC1 needs:

- only PR #73's read-side suppression behavior, or
- the complete governed write/approval workflow from PR #11.

Do not display a public PartSentry claim without the governed approval path.

#### PR #72 — verification review loop

Confirm whether RC1 needs:

- admin verification review,
- mobile status refresh,
- identity-to-marketplace verification bridge.

Do not invent `passport_verified`.

#### PR #66 — mobile drawer

Confirm all registry routes match current canonical routes.

Required canonical routes include:

```text
/marketplace/parts
/marketplace/services
```

Do not retain incorrect Parts/Garages links.

#### PR #58 — Diaspora access hardening

Confirm Marketplace integration does not weaken shipment by-id authorization or persist shipment/container details in marketplace inquiry metadata.

---

## 9. Phase 3 — Remove mixed mock/runtime behavior

Audit every Marketplace data source and UI fallback.

Classify each source as:

- real staging API,
- controlled staging seed,
- local-only fixture,
- visual placeholder,
- legacy mock,
- dead code.

Required outcomes:

1. Stable staging must not silently mix API results with legacy mock listings.
2. Fixture/demo data must remain hidden from public Marketplace endpoints.
3. Visual fallback images must be clearly non-vehicle placeholders and must not misrepresent a listing.
4. Empty states must be honest.
5. Mock data may remain only behind explicit local/test flags.
6. The source of every visible staging card must be traceable to the staging backend/database.
7. Remove or gate legacy `/api/vehicles` Marketplace consumption where the new Marketplace API is required.
8. Document every retained fallback and why it exists.

Create a runtime-data-source map:

| Screen/component | Current source | Intended source | Mock fallback? | Action |
|---|---|---|---|---|

---

## 10. Phase 4 — Align staging database and migrations

Do not apply anything to production.

For the staging database only:

1. Inventory applied migrations.
2. Compare them with the release-candidate migration set.
3. Identify missing, duplicate, or conflicting migrations.
4. Apply only the required idempotent migrations through the approved project migration path.
5. Do not run broad legacy seed scripts.
6. Use a controlled QA seed with traceable records.
7. Ensure test data has enough variation to prove filters and sorting.

The QA dataset must include at least:

- one Toyota,
- vehicles both below and above USD 5,000,
- vehicles both below and above USD 10,000,
- at least three distinct trust values,
- at least one locally-used eligible group,
- at least one listing excluded as a fixture,
- at least one private-owner listing,
- at least one dealer listing if dealer flow is included.

Every QA record must be explicitly marked and removable.

---

## 11. Phase 5 — Create one stable integrated staging deployment

Deploy the same release-candidate commit to:

- stable staging frontend,
- stable staging backend.

Required guarantees:

1. Frontend and backend report the same RC identifier or commit SHA.
2. `VITE_API_URL` points to the stable RC staging backend.
3. No stable staging deployment points to production backend.
4. No frontend preview points to an unrelated backend preview during RC acceptance.
5. The stable staging URL must not change during the Product Owner test window.
6. Record frontend URL, backend URL, commit SHA, database target, and migration version.

Add a safe diagnostics endpoint or build metadata display if one already fits project conventions. Do not expose secrets.

---

## 12. Phase 6 — Automated integrated verification

Run the complete relevant suite from the release-candidate branch.

At minimum:

```bash
node backend/tests/run-tests.js
node --test backend/tests/marketplace-*.test.js
npm run build --workspace=web
npx tsc --noEmit -p web/tsconfig.app.json
cd web && npx vitest run
cd mobile && npx tsc --noEmit
```

Run Playwright against the integrated staging contract, including:

- Marketplace URL parameters,
- navigation coverage,
- Marketplace cards,
- listing detail,
- saved vehicles,
- compare,
- inquiry,
- referral capture,
- seller view,
- admin moderation,
- Parts/Services routes,
- mobile Marketplace contract where practical.

Add or repair tests for these exact URLs:

```text
/marketplace?maxPrice=5000
/marketplace?maxPrice=10000
/marketplace?sort=trust
/marketplace?q=Toyota
/marketplace?category=locally_used
```

Tests must assert visible results, not only URL parsing.

Required assertions:

- `maxPrice=5000` excludes all listings above USD 5,000.
- `maxPrice=10000` excludes all listings above USD 10,000.
- `q=Toyota` returns only matching Toyota listings.
- `sort=trust` produces a deterministic order using differentiated trust values.
- refresh preserves filters.
- browser back/forward preserves state.
- active chips match URL state.
- no mock card is inserted when API data exists.
- no `owner_id` or `tenant_id` leaks publicly.

---

## 13. Phase 7 — Product Owner acceptance test

Provide one stable staging URL and one test-data guide.

The Product Owner must be able to test:

### Public Marketplace

- browse,
- search,
- make filter,
- price filters,
- trust sort,
- category filters,
- listing detail,
- save,
- share,
- compare,
- inquiry.

### Navigation

- desktop navbar,
- mobile drawer,
- footer,
- Feature Registry,
- canonical Parts and Services routes,
- coverage-gated Locally Used link.

### Owner

- login,
- My Listings,
- inquiry visibility,
- listing status.

### Admin

- moderation queue,
- approve/reject/suppress,
- request evidence,
- risk flags,
- reason enforcement,
- analytics where available.

### Diaspora

- create a safe inquiry,
- confirm no shipment/container details leak into Marketplace metadata.

### Mobile

- browse,
- listing detail,
- trust summary,
- Express Interest inquiry,
- registry navigation.

Provide a test sheet with:

- steps,
- account role,
- expected result,
- actual result,
- screenshot field,
- pass/fail field.

Do not ask the Product Owner to discover routes or credentials manually.

---

## 14. Phase 8 — Release-candidate documentation

Create or update:

```text
docs/integration/CARUP_V1_RC1_INTEGRATION_REPORT.md
docs/integration/CARUP_V1_RC1_UAT_CHECKLIST.md
docs/integration/CARUP_V1_RC1_PR_RECONCILIATION.md
```

Document:

- included PRs,
- ported changes,
- deferred PRs,
- superseded work,
- conflicts resolved,
- migrations applied to staging,
- QA seed records,
- staging URLs,
- automated test results,
- manual UAT results,
- known limitations,
- rollback plan,
- release recommendation.

Also update `docs/features/NAVIGATION_INTELLIGENCE.md` if integrated acceptance reveals that its completion wording needs clarification.

---

## 15. Mandatory stop conditions

Stop immediately if:

- integration would write production data,
- more migrations are required than documented,
- a destructive migration is discovered,
- auth or CSRF is weakened,
- PII is exposed,
- feature branches overwrite unrelated work,
- a PR cannot be reconciled without changing its business intent,
- frontend and backend cannot be pinned to the same RC,
- mock and real data cannot be distinguished,
- tests fail in a way that invalidates the acceptance criteria,
- more records would be affected than approved.

When stopping, report:

- exact blocker,
- evidence,
- impacted subsystem,
- safest options,
- recommended decision.

---

## 16. Acceptance criteria

RC1 is ready for merge review only when all of the following are true:

### Environment

- one stable staging frontend,
- one stable staging backend,
- same RC branch/commit,
- staging database only,
- no production writes.

### Data truth

- no hidden mixing of mock and API listing data,
- fixtures hidden by default,
- QA records traceable and removable,
- empty states honest.

### Marketplace URLs

- `maxPrice=5000` visibly works,
- `maxPrice=10000` visibly works,
- `sort=trust` visibly works,
- `q=Toyota` visibly works,
- `category=locally_used` visibly works when coverage is active.

### Cross-feature behavior

- Navigation and Feature Registry agree,
- web and mobile consume compatible Marketplace contracts,
- verification claims remain governed,
- PartSentry claims remain governed,
- referral capture does not mint rewards directly,
- Diaspora inquiry does not persist shipment details,
- admin moderation remains platform-role protected.

### Quality

- required tests pass,
- build and type checks pass,
- UAT checklist completed,
- known failures documented,
- rollback documented,
- no direct merge to `main` without Product Owner approval.

---

## 17. Git and PR workflow

1. Create `release/carup-v1-rc1`.
2. Commit integration work in logical checkpoints.
3. Push the branch.
4. Open a draft PR from `release/carup-v1-rc1` to `main`.
5. Keep it draft during integration and UAT.
6. Include all test and deployment evidence.
7. Do not merge.
8. Stop for Product Owner review after RC acceptance evidence is complete.

---

## 18. Required final report

Report:

- current `main` SHA,
- RC branch,
- RC head SHA,
- draft PR link,
- included PRs,
- ported PR subsets,
- deferred PRs,
- superseded PRs,
- files changed by subsystem,
- staging frontend URL,
- staging backend URL,
- staging database target,
- migrations applied,
- QA data loaded,
- automated test results,
- UAT status,
- unresolved defects,
- rollback procedure,
- recommendation: merge / remediate / defer.

---

## 19. Immediate first action

Begin with **Phase 0 only**.

Do not modify code yet.

Return the full integration matrix and an evidence-based recommendation for the release-candidate composition.

After the Product Owner approves that matrix, execute Phases 1–8 as one milestone, stopping only on mandatory stop conditions.
