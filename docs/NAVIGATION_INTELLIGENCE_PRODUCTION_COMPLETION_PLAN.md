# Navigation Intelligence / Feature Registry — Production Completion Plan

**Workstream:** Lane B — Navigation Intelligence / Feature Registry Mobile Adoption  
**Current implementation PR:** #66 — `feature/mobile-registry-drawer`  
**Purpose:** Complete every remaining phase required to make registry-driven mobile navigation production-ready without expanding into unrelated product workstreams.

---

## 1. Mission

Complete the remaining Navigation Intelligence phases in one coordinated execution loop, using multiple agents where useful, until the feature is demonstrably production-ready.

The feature is considered complete only when:

1. PR #66 is fully reviewed and hardened.
2. Mobile drawer behavior is registry-driven and role-safe.
3. Desktop mega menus remain unchanged.
4. Mobile bottom tabs remain out of scope for this release.
5. Hidden and internal routes never leak into mobile navigation.
6. Route/registry consistency is enforced by automated tests.
7. Mobile, tablet, and desktop regressions are covered.
8. TypeScript, build, and targeted E2E checks pass.
9. Staging/mobile smoke testing is completed and documented.
10. The PR is ready for explicit merge approval.

> **Authorization boundary:** Do not merge PR #66 and do not deploy production unless the user explicitly says: `merge this PR now`.

---

## 2. Existing Completed Foundation

### Phase 1 — Navigation Intelligence / Product UX Cleanup

Completed in PR #54.

Implemented:

- Removed duplicate listings route ambiguity.
- Corrected authenticated and unauthenticated global navigation destinations.
- Exposed Evidence Vault and Upload Evidence in owner/dealer navigation.
- Strengthened protected-route authentication behavior.
- Added navigation regression coverage.

### Phase 2 — Feature Registry / Navigation Map Foundation

Completed in PR #55.

Implemented:

- Added centralized typed `featureRegistry.ts`.
- Registered application features across seven roles.
- Added role metadata and selector helpers.
- Converted dashboard sidebars and role routing to registry consumers.
- Added registry/navigation documentation and tests.
- Kept complex desktop mega-menu arrays intentionally hardcoded.

### Phase 3 — Mobile Adoption Audit and Strategy

Completed during Lane B planning.

Decisions:

- Desktop mega menus remain hardcoded for this release.
- Mobile bottom tabs are deferred to Lane B.2.
- Lane B.1 focuses only on a registry-driven mobile hamburger/drawer.
- No backend changes are part of Lane B.1.
- No Diaspora Trade OS or Vehicle Evidence AI changes are allowed in this workstream.

### Phase 4 — Registry-Driven Mobile Drawer Implementation

Implemented in PR #66.

Current implementation includes:

- `mobile_nav` registry placement.
- `getMobileNavItems(role?)` helper.
- Registry-driven mobile drawer rendering in `Navbar.tsx`.
- Hidden-item filtering.
- Public-only navigation for unauthenticated users.
- Role-aware mobile entries for authenticated users.
- Existing mobile styling preserved.
- Desktop mega menus unchanged.
- No mobile bottom tabs.

This phase is implemented but not yet production-complete because final verification, tests, staging QA, consistency guards, and release evidence remain outstanding.

---

## 3. Scope Lock

### In scope

- `web/src/config/featureRegistry.ts`
- `web/src/components/layout/Navbar.tsx`
- Navigation-related tests
- Route/registry validation tests
- Mobile/tablet/desktop responsive verification
- Documentation for production readiness
- PR #66 hardening and evidence

### Out of scope

- Diaspora Trade OS
- Vehicle Evidence AI
- Backend routes or schemas
- Trust scoring
- Evidence approval logic
- Desktop mega-menu migration
- Mobile bottom tab navigation
- Native Expo/React Native implementation
- Any unrelated UI redesign
- Production deployment before explicit approval

If any agent encounters unrelated work, it must stop that subtask and report the mismatch.

---

## 4. Parallel Agent Work Rules

Claude may use multiple agents, but each agent must operate in an isolated branch or git worktree.

Before changing files, every agent must report:

1. Current branch or worktree.
2. Clean `git status --short`.
3. Assigned phase.
4. Expected files to change.

No agent may reuse a working directory actively used by another workstream.

Recommended work split:

- **Agent A — Registry and security audit**
- **Agent B — Mobile drawer E2E tests**
- **Agent C — Route/registry consistency guard**
- **Agent D — Responsive/staging QA and release evidence**
- **Lead agent — integration, conflict resolution, final PR update**

All changes must converge onto `feature/mobile-registry-drawer` or a clearly documented successor branch based on PR #66.

---

## 5. Phase 4 Completion — PR #66 Deep Verification

### Goal

Prove that the existing implementation is correctly scoped and safe before adding further hardening.

### Required checks

1. Confirm PR #66 is open and mergeable.
2. Confirm changed files initially match the intended two-file implementation.
3. Review the exact diff for:
   - accidental desktop-menu changes;
   - hidden-route leakage;
   - role leakage;
   - duplicate links;
   - missing keys or unstable ordering;
   - unsafe role fallback behavior.
4. Confirm unauthenticated users only receive `requiresAuth === false` items.
5. Confirm authenticated users receive:
   - public mobile items; and
   - items explicitly assigned to their role.
6. Confirm `isHidden` items are always excluded.
7. Confirm the mobile drawer closes after navigation.
8. Confirm active route highlighting remains correct.
9. Confirm all icons resolve through the existing icon resolver.
10. Confirm desktop mega-menu components remain byte-for-byte or behaviorally unchanged.

### Acceptance criteria

- No unrelated files.
- No backend changes.
- No hidden route exposed.
- No cross-role route leakage.
- No desktop regression.

---

## 6. Phase 5 — Automated Mobile Navigation Hardening

### Goal

Add focused automated coverage that proves mobile navigation works for public users and all supported authenticated roles.

### Required test coverage

#### Public / unauthenticated

- Mobile menu button appears at mobile viewport.
- Drawer opens.
- Only public `mobile_nav` entries render.
- No dashboard, admin, government, bank, dealer, owner, insurance, or mechanic private links render.
- Login and registration links behave correctly.
- Selecting a link closes the drawer.

#### Owner

- Owner role receives intended owner mobile entries.
- Owner cannot see dealer/admin/government/bank-only routes.
- Hidden owner routes remain excluded.
- Garage and owner tools navigate correctly.

#### Dealer

- Dealer receives inventory and dealer-related entries.
- Dealer cannot see owner-only or administrative entries.
- Drawer closes after route selection.

#### Mechanic

- Mechanic receives mechanic workflow entries.
- No insurance, bank, government, or admin leakage.

#### Insurance

- Insurance receives insurance workflow entries.
- No mechanic, bank, owner, dealer, or admin leakage.

#### Government

- Government receives registry/government entries.
- Government-only entries are absent for normal roles.

#### Admin

- Admin receives intended admin entries.
- Admin entries never appear for public or normal roles.

#### Bank

- Bank receives intended banking workflow entries.
- Bank entries never appear for unrelated roles.

#### Cross-cutting behavior

- No duplicate hrefs within a rendered drawer.
- Every rendered mobile entry has a valid route.
- Active-route styling works.
- Drawer closes after navigation.
- Browser back/forward behavior remains correct.
- Desktop mega menus remain unchanged at desktop viewport.
- Tablet breakpoint transitions cleanly.

### Test implementation guidance

Prefer a dedicated Playwright specification, for example:

`tests/agents/28-mobile-registry-navigation.spec.ts`

or the repository’s current equivalent E2E location if conventions differ.

Use deterministic mocked users/roles where possible. Avoid production Supabase and production credentials.

### Acceptance criteria

- Targeted navigation tests pass.
- Existing navigation regression tests still pass.
- No test requires a production service-role key.

---

## 7. Phase 6 — Route / Registry Consistency Guard

### Goal

Prevent future drift between `featureRegistry.ts` and `App.tsx` route declarations.

### Required validations

Add a deterministic test or validation utility that verifies:

1. Every navigable registry route exists in the application route map.
2. Every `mobile_nav` route exists.
3. No duplicate feature IDs exist.
4. No duplicate mobile route entries exist per role.
5. Every role value is one of the seven supported roles.
6. Hidden features never appear in public/mobile selectors.
7. Auth-required features never appear for unauthenticated selectors.
8. Every icon string used by mobile navigation resolves.
9. Every `mobile_nav` item has a usable label and route.
10. Registry selectors preserve deterministic ordering.

### Important constraint

Do not refactor `App.tsx` into registry-generated routes in this phase. The goal is consistency validation, not router architecture replacement.

### Acceptance criteria

- Validation catches intentionally injected bad route/role/duplicate cases.
- Validation runs in CI or the standard test suite.

---

## 8. Phase 7 — Responsive and Accessibility QA

### Goal

Verify the mobile drawer is usable and safe across mobile, tablet, and desktop breakpoints.

### Viewports

At minimum test:

- Small iPhone viewport.
- Large iPhone viewport.
- Common Android viewport.
- Small tablet portrait.
- Tablet landscape.
- Desktop viewport.

### Functional checks

- Drawer opens and closes reliably.
- Drawer content scrolls when long.
- Overlay prevents accidental background interaction.
- Active route remains visible.
- Role switch or sign-out refreshes mobile items correctly.
- Refreshing a nested mobile route does not break navigation.
- Back button does not leave drawer state stuck.

### Accessibility checks

- Menu trigger has an accessible name.
- Drawer has appropriate dialog/navigation semantics.
- Escape closes the drawer.
- Focus moves into the drawer when opened.
- Focus returns to the trigger when closed.
- Keyboard navigation reaches every item.
- Current route is announced with `aria-current` or equivalent.
- Touch targets meet practical mobile sizing.
- Color contrast remains acceptable.

### Acceptance criteria

- No blocker-level mobile or accessibility defect.
- Any non-blocking issue is documented with severity and follow-up.

---

## 9. Phase 8 — Build, CI, and Staging Verification

### Required commands

Run from the correct repository root:

```bash
npx tsc --noEmit --project web/tsconfig.app.json
npm run build
```

Run the targeted navigation E2E suite and existing navigation regression suite.

Also run:

```bash
git diff --check
```

### CI interpretation

- Distinguish code/test failures from infrastructure failures.
- Vercel build-rate-limit failures must be documented separately and must not be misrepresented as code failures.
- Do not bypass genuine test failures.

### Staging QA

Use the PR preview/staging deployment when available.

Verify:

- public mobile drawer;
- owner drawer;
- dealer drawer;
- admin/government drawer;
- at least one additional role;
- desktop menu regression;
- tablet transition;
- deep-link refresh.

Capture screenshots or concise evidence for each critical scenario.

### Acceptance criteria

- TypeScript passes.
- Production build passes.
- Targeted E2E passes.
- Existing nav regression passes.
- Staging smoke passes or infrastructure blocker is precisely documented.

---

## 10. Phase 9 — Production Readiness Gate

### Goal

Prepare PR #66 for explicit merge approval with a complete, auditable report.

### Required final report

The lead agent must report:

1. PR number and state.
2. Mergeability.
3. Head SHA.
4. Final changed files.
5. Exact phase-by-phase completion status.
6. Test commands and results.
7. CI/deployment status.
8. Staging QA results.
9. Accessibility results.
10. Confirmed absence of:
    - hidden-route leakage;
    - role leakage;
    - desktop mega-menu changes;
    - mobile bottom tabs;
    - backend changes;
    - Diaspora changes;
    - Vehicle Evidence changes.
11. Rollback recommendation.
12. Final merge recommendation.

### Hard stop

Do not merge until the user explicitly says:

`merge this PR now`

When that approval is given:

1. Squash merge PR #66.
2. Pull `main`.
3. Run a light post-merge smoke check.
4. Confirm main SHA and clean working tree.
5. Do not start Lane B.2 automatically.

---

## 11. Deferred Work — Do Not Pull Into This Release

### Lane B.2 — Mobile Bottom Tabs

Deferred until the registry-driven drawer is stable in production.

Potential future scope:

- 4–5 primary tabs per role.
- Safe-area support.
- Active tab state.
- Drawer for secondary actions.
- Tablet-specific behavior.

### Lane B.3 — Desktop Mega-Menu Registry Migration

Deferred because the current nested menu structure has a richer shape and greater regression risk.

Potential future scope:

- parent/child registry schema;
- marketing copy and descriptions;
- badges and grouped sections;
- hover/focus behavior;
- coverage-gated links.

### Lane B.4 — Native Mobile Shared Registry

Deferred to native mobile integration.

Potential future scope:

- shared platform-neutral registry package;
- native screen identifiers;
- Expo/React Native icon adapters;
- deep-link mapping;
- native role-aware tabs/drawers.

---

## 12. Security and Secret Handling

- Never print, paste, or export production Supabase service-role keys in logs.
- Use environment variable names only.
- Do not run this feature’s tests against production Supabase.
- Use mocks, local fixtures, or staging-safe credentials.
- If a production secret is found in logs, report it and rotate it outside this feature branch.

---

## 13. Definition of Done

This plan is complete only when all of the following are true:

- [ ] PR #66 diff reviewed and scoped.
- [ ] Mobile registry helper behavior verified.
- [ ] Public-user mobile test passed.
- [ ] All seven role tests passed.
- [ ] Hidden-route exclusion test passed.
- [ ] No duplicate mobile links.
- [ ] Drawer close/navigation behavior passed.
- [ ] Desktop mega-menu regression passed.
- [ ] Tablet breakpoint test passed.
- [ ] Route/registry consistency guard added and passed.
- [ ] Icon resolution guard passed.
- [ ] Accessibility checks completed.
- [ ] TypeScript passed.
- [ ] Production build passed.
- [ ] `git diff --check` passed.
- [ ] Targeted E2E passed.
- [ ] Existing navigation regression passed.
- [ ] Staging/mobile smoke completed.
- [ ] Final PR report produced.
- [ ] No unrelated files or workstreams included.
- [ ] PR is ready for explicit merge approval.

---

## 14. Execution Loop Contract

Claude should continue iterating until the Definition of Done is satisfied or a genuine external authorization/infrastructure blocker is reached.

For each failed check:

1. Identify the exact root cause.
2. Fix only within this workstream’s scope.
3. Re-run the narrow failed check.
4. Re-run relevant regression checks.
5. Update the PR and evidence.

Do not stop merely because the first implementation compiles. Stop only when the production-readiness goal is reached, or when explicit user authorization is required for merge/production deployment.
