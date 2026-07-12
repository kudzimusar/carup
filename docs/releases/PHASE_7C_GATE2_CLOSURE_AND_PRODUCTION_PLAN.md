# Phase 7C — Gate 2 Closure & Production Plan (authoritative ledger)

Branch: `phase-7c-native-verification-production-loop` · PR: **#72** · Base: `main`
Ledger maintained continuously. All claims below are backed by commands/SHAs/totals.

> Scope of the feature loop being closed: mobile login → submit controlled
> verification evidence → backend creates & processes the session → unsafe/
> non-document evidence is quarantined → admin reviews → admin requests
> resubmission / approves / rejects / escalates → mobile refreshes the real
> persisted status → user resubmits when requested → final decision appears
> truthfully on mobile → audit history is complete and immutable.

---

## Task board

| # | Item | State | Evidence |
|---|------|-------|----------|
| S0 | Repository & PR forensics | **VERIFIED (LOCAL)** | This ledger, §Stage 0 |
| S1 | Gate 2 launcher recovered/authored | **IMPLEMENTED — UNVERIFIED (device)** | `scripts/start-phase7c-gate2-mobile.sh` + 15/15 shell checks |
| S2 | Automated backend Phase 7C validation | **VERIFIED (LOCAL)** | 117/117 backend tests, §Stage 2 |
| S2 | Mobile ts/vitest/static-guards/expo export | **VERIFIED (LOCAL)** | tsc 0 · vitest 18/18 · static 4+59 · iOS export OK, §Stage 2 |
| S2 | Web ts/test/build | **VERIFIED (LOCAL)** | tsc 0 · vitest 119/119 · build ✓, §Stage 2 |
| S2 | git diff --check + secret/artifact scan | **VERIFIED (LOCAL)** | clean · 0 credential markers, §Stage 2 |
| S3 | Staging migration reconciliation | **VERIFIED ON STAGING** | 5/5 applied via repo tooling; verify exit 0; rows preserved (§report) |
| S4 | Deploy tested SHA to staging | **VERIFIED ON STAGING** | branch aliases live; health 200; web targets staging (VITE_API_URL fixed) |
| S5 | Full staging acceptance matrix | **AUTOMATED PASS** | 26/26 harness ×2 + 13/13 extended; P1 idempotency defect fixed `d8bed39` (§report) |
| S6 | Owner physical-device Gate 2 | **BLOCKED — EXTERNAL (owner)** | requires a human + device |
| S8 | One clean current-main release PR | **DONE — PR #115 OPEN** | merge `ff0e6c9` + qualification `00e0a1d`; battery green (§Stage 8) |
| S9 | PR consolidation (#72/#76) | **DONE** | #72 CLOSED superseded; #76 7C-snapshot superseded (comment); `docs/PROJECT_PR_CONSOLIDATION_LEDGER.md` |
| S11 | Production preflight | **BLOCKED — EXTERNAL** | no prod Supabase/Vercel access |
| S12 | Production cutover | **BLOCKED — EXTERNAL (authorization)** | needs `AUTHORIZE PHASE 7C PRODUCTION CUTOVER` |

---

## Stage 0 — Repository & PR forensics (read-only, verified this session)

Commands run from `/Users/.../carup-kimi` after `git fetch --all --prune`.

- `origin/main` tip: **`d1837a8`** (`docs(release): Vehicle Trust OS production cutover closeout`).
- **PR #72** `phase-7c-native-verification-production-loop`: OPEN, not draft, head **`12d1e074`**, base `main`.
  - Divergence `git rev-list --left-right --count origin/main...origin/phase-7c...`: **66 (main-only) / 202 (branch-only)** → highly diverged; do **not** merge directly.
  - `statusCheckRollup`: 4/4 Vercel checks SUCCESS (carup, carup-staging, carup-backend, carup-backend-staging). No GitHub Actions **test** workflow exists for Phase 7C (only `diaspora-live-validation*.yml`).
- **PR #76** `release/carup-v1-rc1`: OPEN, **draft**, head **`fcc8a100`**, base `main`. Divergence **66 / 335** → stale integrated RC1 with an older Phase 7C snapshot. Not to be merged blindly.
- No dedicated Phase 7C worktree existed; created `../carup-phase7c` on the PR #72 branch and fast-forwarded local `09cb6b5 → 12d1e074` (clean fast-forward, no divergence).

Artifact presence (on PR #72 branch vs main):

| Artifact | PR #72 branch | main |
|----------|:---:|:---:|
| `scripts/start-phase7c-gate2-mobile.sh` | **ABSENT → now authored** | absent |
| `docs/guides/PHASE_7C_GATE2_OWNER_MOBILE_TEST.md` | present | absent |
| `mobile/package.json`, `package-lock.json` | present | present |
| 4× `database/migrations/2026061*_verification_*.sql` | present | **absent** |
| backend `verification-*`/`ocr-*`/`identity-*` tests | present | absent |

The launcher was reported as previously existing but was **not found anywhere on disk or in git** (any worktree, committed or not) — it has been **authored fresh**, not recovered.

---

## Stage 1 — Gate 2 launcher (authored + verified)

Files:
- `scripts/start-phase7c-gate2-mobile.sh` — the launcher (all 20 required behaviours).
- `scripts/phase7c-gate2-launcher.verify.sh` — deterministic shell verification.

Behaviour ↔ requirement mapping is implemented for all 20 points (repo-root/mobile
invocation, CarUp-repo confirmation, disk check default 2500 MB + `PHASE7C_GATE2_MIN_FREE_MB`,
create-`.env.local`-only-when-missing/never-overwrite, validate-without-printing,
require deployed https staging backend, reject localhost/127.0.0.1/0.0.0.0/dev-fallback,
require local-dev fallbacks disabled, never print secrets, focused workspace-preserving
install, resolve `expo-router/entry` + `react-native-web` + `semver/functions/satisfies`
+ `react-native-reanimated`, LAN default, `--tunnel`, `--verify-only`, cleanup
instructions, non-zero exit on every unmet prerequisite).

`.gitignore` excludes `mobile/.env.local` (`git check-ignore` → IGNORED). The launcher
never overwrites an existing env file and never prints its contents.

**Verification result (this session):**
```
bash scripts/phase7c-gate2-launcher.verify.sh
TOTAL: pass=15 fail=0
```
Covers all required cases: missing env (template created + rejected), valid env,
incompatible (non-https) backend, localhost, 0.0.0.0, dev-fallback enabled,
localhost-api fallback enabled, low disk, unresolved dependency, verify-only
success (Expo not started), verify-only failure, and no-secret-output (a token in
the URL query + an extra secret line never appear in output).

> Real resolution of the four RN modules against an installed workspace is a
> Stage 2 `--verify-only` step (a fresh worktree has no `node_modules`); the shell
> suite proves the guard logic deterministically via `PHASE7C_GATE2_REQUIRE_MODULES`.

---

## Stage 2 — Automated validation

**Backend Phase 7C suites — VERIFIED (117/117).**
```
cd backend && env SUPABASE_URL=http://localhost:54321 \
  SUPABASE_SERVICE_ROLE_KEY=dummy_ci_key_not_a_secret JWT_SECRET=dummy_ci_jwt_secret \
  NODE_ENV=test ALLOW_OCR_MOCK=true \
  node --test tests/verification-session-workflow.test.js \
    tests/verification-admin-review.test.js tests/verification-decision-policy.test.js \
    tests/verification-ocr-provenance.test.js tests/ocr-mock-guard.test.js \
    tests/identity-binding.test.js tests/identity-document-classifier.test.js \
    tests/identity-evidence-validation.test.js tests/evidence-validation.test.js \
    tests/evidence-api.test.js tests/evidence-ai-fraud.test.js tests/audit-logger.test.js
→ tests 117 · pass 117 · fail 0 · skipped 0
```
Covers: verification session workflow, admin review, decision policy, decision
recording, reason codes, identity binding, document classification & quarantine,
evidence validation, OCR mock guard, OCR provenance, audit logging, authorization
boundaries, fail-closed on non-document/low-confidence/mismatch.

**Env contract (documented, not a defect):** the OCR/classifier mock path is gated
behind `ALLOW_OCR_MOCK=true` **with** `NODE_ENV=test` (see `documentClassifier.js`:
`if (!GEMINI_API_KEY && !mockAllowed) return 'Classification provider unavailable.'`).
This is a deliberate safety guard so production can never use mock OCR. Running the
suites without the flag produces 9 expected "provider unavailable" failures; with the
flag, 117/117 pass.

**Full-stack validation — VERIFIED (2026-07-10, after full `npm install`, 1166+3 pkgs):**

| Check | Command | Result |
|-------|---------|--------|
| Launcher real verify | `PHASE7C_GATE2_ENV_FILE=<staging-valid tmp> ./scripts/start-phase7c-gate2-mobile.sh --verify-only` | PASS — all 4 default modules resolved for real |
| Mobile TypeScript | `npm run ts:check --workspace=mobile` | 0 errors |
| Mobile vitest | `npm test` (mobile) | **18/18** (1 file) |
| Mobile static guards | `npm run test:static` (mobile) | **4 guard scripts PASS + smoke 59/59** |
| Web TypeScript | `npx tsc -p web/tsconfig.app.json --noEmit` | 0 errors |
| Web unit | `npx vitest run` (web) | **119/119** (8 files) |
| Web production build | `npm run build --workspace=web` | ✓ built (chunk-size warning only) |
| Expo iOS export | `npx expo export --platform ios --output-dir dist-phase7c-gate2 --clear` | ✓ Hermes bundle 5.28 MB + metadata |
| `git diff --check` | — | clean |
| Secret scan (tracked) | pattern grep | only runtime-generated `sk_live_` prefixes (dispositioned in `SECRET_EXPOSURE_AUDIT.md`); no stored credentials; no service-role assignments in tracked env files |
| Artifact scan | `web/dist` + `mobile/dist-phase7c-gate2` | **0 credential markers** |

**Defect found & fixed by this pass (silent test-coverage hole):**
`mobile/vitest.config.ts` hard-pinned `include` to a single file, so 4 static guard
scripts + a 59-assertion flow-smoke script never ran under any wired command, and any
future vitest suite would be silently skipped. Fixed: glob include with explicit
excludes for the 5 standalone `tsx` scripts, new `test` + `test:static` npm scripts in
`mobile/package.json`, and `tsx` pinned as a real devDependency (was fetched ad-hoc by
npx). `mobile/dist-phase7c-gate2/` added to `mobile/.gitignore` (build artifact).

---

## Migration manifest (SHA-256, from PR #72 branch)

| Order | Migration | sha256 | On main? |
|------:|-----------|--------|:---:|
| 1 | `20260613020000_verification_admin_review.sql` | `43cae551e8c82d88073a5d015cd3992b537db4466af55d0c929ff9440f7c8271` | no |
| 2 | `20260618030000_verification_ocr_provenance.sql` | `432a98531bb27031f2ab3322fdd0c642f0f3e5fcb4642a35b9160fd4d22bf993` | no |
| 3 | `20260618040000_verification_case_management.sql` | `bec9f67a3c0fc4abc1bd9ae09cf88cfd8492dfdee2b920320026713a583ab2b6` | no |
| 4 | `20260618050000_verification_evidence_trust_columns.sql` | `0e19346e959c0a6ceb6fb4361990886d4efdfa26daf7a85f343410fbc6b4bed4` | no |

Staging (`eoyenigwevnxwwhyhaer`) / production (`vhmnajoeicasaigiophh`) applied-state
**not yet inventoried** — blocked (see below). Apply order is chronological (1→4).

---

## PR disposition (running record)

| PR | Feature | Disposition | Successor | State |
|----|---------|-------------|-----------|-------|
| #72 | Phase 7C native verification | integrate delta via clean release branch; then close as superseded | (Stage 8 release PR — TBD) | OPEN |
| #76 | Stale RC1 (marketplace/PartSentry/registry/Diaspora + old 7C snapshot) | Phase 7C snapshot superseded by clean release PR; broader components need independent successors before closing | mixed — TBD | OPEN (draft) |

---

## Blockers — external (this environment cannot satisfy)

1. **Supabase access to CarUp projects.** The connected Supabase account (`list_projects`)
   exposes only `sfhtlzcgrnrdznhvdrbn` ("production-os", INACTIVE) — **not** CarUp staging
   `eoyenigwevnxwwhyhaer` or production `vhmnajoeicasaigiophh`. Blocks Stage 3 (staging
   migration inventory/apply/advisors), Stage 5 (staging DB acceptance), Stage 11
   (production inventory), Stage 12 (production migrations).
2. **Vercel deploy.** The `vercel` MCP requires interactive OAuth; this session is
   non-interactive. Blocks driving/verifying Stage 4 and Stage 12 deployments.
3. **Owner physical-device Gate 2 (Stage 6).** Requires a human with a device; cannot be
   simulated.
4. **Production authorization (Stage 12).** Requires the exact phrase
   `AUTHORIZE PHASE 7C PRODUCTION CUTOVER`.

Everything **not** gated by the above is being driven autonomously.

---

## Next autonomous actions (unblocked)

- Run mobile + web Stage 2 validation (after workspace install) and record exact totals.
- Build the Stage 8 Phase 7C delta matrix (commits unique to #72 vs already-on-main vs #76).
- Draft the clean `release/phase7c-verification-production` branch from latest `main`
  (integration executed once staging verification is unblocked or on owner instruction).

## Handoffs required from the owner (to unblock)

- Supabase access to `eoyenigwevnxwwhyhaer` (and later `vhmnajoeicasaigiophh`), or run the
  repo's `scripts/*phase7c-staging*` tooling with credentials.
- A deployed staging backend URL for `EXPO_PUBLIC_API_URL` + owner-device Gate 2 run.
- The production authorization phrase when preflight is green.


---

## Stage 8/9 — executed 2026-07-10

**Shallow-clone correction.** The Stage 0 divergence numbers (66/202, 335/66, "no
merge base") were artifacts of a shallow clone (3 grafts). After
`git fetch --unshallow`: main↔#72 true divergence **347 / 47**, merge-base
`dd0b6e5` (Phase 7B OCR persistence). All 47 branch-only commits were
Phase 7C-scoped — no RC1 baggage — so a normal history-preserving merge was used.

**Release branch** `release/phase7c-verification-production` cut from
`main@ce14e32`; merge `ff0e6c9` resolved all 19 conflict hunks across 14 files
(policy: preserve newer main behavior — hardened `resolveCsrfSecret`, canonical
apiBase/marketplaceApi, shared icon registry, NotFoundPage — plus the 7C delta:
`/admin/verification` route+UI, RoleSwitchResult+CSRF role switch, stale-CSRF
retry, verification CTA/testIDs). Qualification `00e0a1d`: feature-manifest
regenerated (87 features), tab-guard patterns generalized (URL-context host
check; canonical-resolver/delegated-util acceptance + util assertions), mobile
vitest excludes list all 14 standalone tsx scripts.

**Release-branch verification (head `00e0a1d`):** backend 7C **131/131** · web
vitest **501/501** · mobile vitest **18/18** · static guards 4 scripts + 59/59
smoke ALL PASS · main's 9 standalone scripts ALL PASS · web/mobile tsc 0 · web
build ✓ · Expo iOS export ✓ · launcher verify PASS + 15/15 · diff-check/secret
scan clean. **Known pre-existing main defect (P2, not from this merge):**
`native-boundary-audit` fails identically on pristine `main@ce14e32`
(communications tab #100 lacks NativeFeatureBoundary).

**PR consolidation:** #72 **CLOSED** as superseded (comment with final evidence);
#76 Phase 7C snapshot formally superseded (comment), PR left open pending
disposition of its unrelated components; ledger:
`docs/PROJECT_PR_CONSOLIDATION_LEDGER.md`. Release PR: **#115** (0 behind main
at creation).
