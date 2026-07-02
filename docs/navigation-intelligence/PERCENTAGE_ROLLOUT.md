# Deterministic Percentage Rollout (Milestone G)

Release a feature to a stable percentage of eligible subjects — deterministic,
audited, authorization-safe. **No per-request randomness.**

## Schema

`database/migrations/20260623120000_feature_rollout_percentage.sql` (staging-first,
additive, reversible) extends `feature_rollout_overrides`:

- `rollout_percentage SMALLINT NOT NULL DEFAULT 100` (CHECK `0–100`)
- `rollout_seed TEXT` (CHECK length ≤ 64)

Existing rows default to **100 %** → no behavior change on apply. `ADD COLUMN IF NOT
EXISTS` + guarded `DO`-block CHECKs make re-apply safe. **Not applied to production.**

## Deterministic assignment

`rolloutBucket(featureId, environment, seed, subject)` = `SHA-256(\`${featureId}|${environment}|${seed||''}|${subject}\`)`,
first 4 bytes as a BE uint32 `% 100` → bucket `0–99`. Pure and identical across
processes/instances/restarts (verified by a cross-instance test). `passesPercentage`:
`≥100 → always in`, `≤0 → never in`, otherwise `bucket < percentage` **iff a stable
subject exists**.

## Stable subject priority (computed in the evaluator from trusted ctx)

1. authenticated `user_id`
2. `user_id:tenantId` when a verified tenant context
3. anonymous cohort `cohort:<x-nav-cohort>` (opaque, web localStorage / native SecureStore)
4. none → **conservative: a `<100 %` feature stays gated** for un-bucketable callers

The cohort is **not** authentication — it only buckets. Switching tenant can move a
user's bucket for the same feature (intended).

## Evaluation order (percentage only NARROWS)

```
static lifecycle → override lifecycle/enabled → immutable-role intersect
→ role eligibility → tenant allow/deny → PERCENTAGE → visible/accessible
```

`visible = lifecycleVisible && roleEligible && enabled && tenantOk && inRollout` (same for
`accessible`). Because `inRollout` is **ANDed** alongside role/tenant, percentage can only
flip exposure **off** — role/tenant denial still wins first, and percentage **never broadens**
access. `state`/`enabled` stay truthful; only `visible`/`accessible` flip when bucketed out.
The sanitized public effective state **never leaks** the raw subject or bucket.

## API + Admin Console

`PATCH /api/admin/features/:featureId/rollout` (`authorizeRole(['admin'])`, optimistic
`expectedVersion` → 409) accepts `rollout_percentage` (int 0–100) and `rollout_seed`
(≤64 or null), validated and audited (`FEATURE_ROLLOUT_*`, no raw subject). Reset (DELETE)
returns to the static default (100 %). The console adds a number input + accessible slider,
current %, an exposure explanation, a seed-rotation field, before/after confirmation, and
warnings for **0 %** (fully gated), **partial**, **seed rotation** (cohorts reshuffle), and
**production**.

## Clients

Web (`FeatureGovernanceContext.tsx`) and native (`featureGovernanceStore.ts`) generate a
stable opaque cohort id (localStorage / SecureStore key `carup_nav_cohort`) and send it as
`x-nav-cohort` on `/features/effective`. No PII.

## Tests

`backend/tests/feature-governance-rollout.test.js` (DB-free): 0 %/100 % boundaries;
same-subject stability across repeated evals AND fresh instances; seed change reshuffles;
role/tenant/time denial wins before percentage; anonymous-no-cohort conservative;
cohort-stable anonymous; invalid percentage/seed → validation error; non-admin denied;
version conflict 409; audit row carries no raw subject; reset → default; and a **non-flaky
distribution check** over 2000 deterministic synthetic subjects: 10 %→10.2 %, 25 %→25.25 %,
50 %→49.95 %, 75 %→75.0 % (all within ±5 %).

## Staging apply status

Staging-first for `eoyenigwevnxwwhyhaer`; applied/verified by the release engineer (see
`NAVIGATION_BLUEPRINT_STAGING_PLAN.md`). **Production not migrated.**
