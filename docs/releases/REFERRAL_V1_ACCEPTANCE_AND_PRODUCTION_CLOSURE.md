# CarUp Referral Engine V1 — Acceptance and Production Closure Ledger

> **Single source of truth.** Do not create parallel Referral V1 acceptance or closure reports.

## Scope lock

- Repository: `kudzimusar/carup`
- Programme in scope: **Referral Engine V1 only**
- Full-Vision / Wave A: **excluded**
- PR #105: **excluded; do not merge, rebase, deploy, or migrate**
- Production authorization phrase: `AUTHORIZE REFERRAL V1 PRODUCTION CUTOVER`
- Production changes are prohibited during Stages 0–8.
- No real customer contacts, real rewards, external-provider activation, Docker installation, or Wave A migrations are authorized.

## Stage ledger

| Stage | Status | Production changed |
|---|---|---|
| 0 — Freeze and verify current state | **PASS** | No |
| 1 — Current-main automated regression | NOT STARTED | No |
| 2 — Staging schema and account readiness | NOT STARTED | No |
| 3 — Staging admin web acceptance | NOT STARTED | No |
| 4 — Owner/invitee correct-attribution journey | NOT STARTED | No |
| 5 — Import/container referral journey | NOT STARTED | No |
| 6 — Simulated channel-attribution integration | NOT STARTED | No |
| 7 — Adversarial security gate | NOT STARTED | No |
| 8 — Owner physical-device mobile gate | NOT STARTED | No |
| 9 — Read-only production preflight | LOCKED | No |
| 10 — Owner-authorized migration and cutover | LOCKED | No |
| 11 — Controlled production acceptance | LOCKED | No |
| 12 — Production test-data cleanup | LOCKED | No |
| 13 — Documentation and formal closure | LOCKED | No |

---

# Stage 0 — Freeze and verify current state

- Executed: `2026-07-15`
- Gate result: **PASS**
- Production changed: **No**
- Database writes: **None**
- Deployments promoted/re-aliased: **None**
- PRs merged/rebased: **None**

## 1. Exact current main SHA

```text
6214f3dd7aef7a24d33170009164d8f4932ab429
```

Commit:

```text
docs(phase7c): production cutover completion report (#116)
```

The commit is documentation-only and explicitly records that no application code, migrations, environment variables, or deployment aliases changed.

## 2. Repository and working-tree state

- GitHub default branch: `main`
- Remote `main` frozen at the exact SHA above.
- This execution used atomic GitHub API operations rather than a mutable local checkout; therefore there is no uncommitted local working tree in this execution context.
- Stage 0 evidence branch: `docs/referral-v1-stage0-baseline`
- Branch base: exact `main` SHA `6214f3dd7aef7a24d33170009164d8f4932ab429`
- Intended branch delta: this ledger file only.

## 3. Referral-related PR disposition

### Current open referral PR search

Only one open pull request matched the referral scope:

| PR | State | Merged | Mergeable | Disposition |
|---|---|---:|---:|---|
| #105 — `feat(referral): Wave A Identity Attribution and Universal Widget` | Open | No | No | **Historical Full-Vision Wave A; excluded from V1; do not merge, rebase, deploy, or migrate** |

### V1 release baseline

| PR | State | Merged | Disposition |
|---|---|---:|---|
| #88 — `feat(referrals): Referral Engine Release Candidate` | Closed | Yes | Merged V1 implementation and historical acceptance evidence; must be rerun against current `main` |

No other open referral pull request was returned by the repository search.

## 4. Current-main Vercel deployment checks

GitHub's combined status for current `main` reports all four Vercel contexts as `success`.

| Environment | Tier | Vercel project | Current-main deployment/status identifier | Status |
|---|---|---|---|---|
| Staging | Frontend | `carup-staging` | `HbrVKVVFdf9viUrzqTy5VjZo2Cmk` | **success** |
| Staging | Backend | `carup-backend-staging` | `G5cUsPJQN6j2LX1Zh5mLwr8FLXvE` | **success** |
| Production | Frontend | `carup` | `657vEa7n3zxwr4LywiAH8WdhBzde` | **success** |
| Production | Backend | `carup-backend` | `AWys3Qth5ngPN8B4GBpwunmEdkqf` | **success** |

Canonical application URLs recorded in the repository:

```text
Staging frontend:  https://carup-staging.vercel.app
Staging backend:   https://carup-backend-staging.vercel.app
Production frontend: https://carup.vercel.app
Production backend:  https://carup-backend.vercel.app
```

Runtime-health continuity evidence:

- Latest staging acceptance evidence records backend `/api/health` HTTP 200 with Supabase healthy, web HTTP 200, staging backend baked into the frontend bundle, and zero production references in that bundle.
- Latest production cutover evidence records backend health HTTP 200 with Supabase healthy and frontend HTTP 200.
- The current-main commit is documentation-only and states that it did not change runtime code, environment variables, or deployment aliases.

## 5. Supabase project-binding proof

Direct Supabase project inventory:

| Environment | Project name | Project ref | API URL | Region | Project health |
|---|---|---|---|---|---|
| Staging | `carup-staging` | `eoyenigwevnxwwhyhaer` | `https://eoyenigwevnxwwhyhaer.supabase.co` | `ap-southeast-2` | **ACTIVE_HEALTHY** |
| Production | `CarUp` | `vhmnajoeicasaigiophh` | `https://vhmnajoeicasaigiophh.supabase.co` | `ap-south-1` | **ACTIVE_HEALTHY** |

Binding conclusion:

- Staging deployment pair is `carup-staging` + `carup-backend-staging`, with direct project ref `eoyenigwevnxwwhyhaer`.
- Production deployment pair is `carup` + `carup-backend`, with direct project ref `vhmnajoeicasaigiophh`.
- No production binding or environment value was modified during Stage 0.

## 6. Read-only referral schema inventory

The following read-only catalogue query was executed separately against staging and production:

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.policyname)::int as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname like 'referral\_%' escape '\'
group by c.relname, c.relrowsecurity
order by c.relname;
```

### Staging — `eoyenigwevnxwwhyhaer`

Count: **9**

| Table | RLS enabled | Policy count |
|---|---:|---:|
| `referral_admin_audit_events` | Yes | 0 |
| `referral_campaigns` | Yes | 0 |
| `referral_codes` | Yes | 0 |
| `referral_coupon_redemptions` | Yes | 0 |
| `referral_coupons` | Yes | 0 |
| `referral_events` | Yes | 0 |
| `referral_share_assets` | Yes | 0 |
| `referral_wallet_transactions` | Yes | 0 |
| `referral_wallets` | Yes | 0 |

Interpretation: RLS is enabled on all nine foundation tables. Zero policies preserves the existing server-owned, deny-by-default posture for direct client access.

### Production — `vhmnajoeicasaigiophh`

Count: **0**

```text
No public referral_* tables exist.
```

Production Referral V1 migration has not been applied.

## 7. PR #105 exclusion confirmation

```text
CONFIRMED EXCLUDED
```

PR #105 remains open, unmerged, and not mergeable. No merge, rebase, deployment, migration, branch update, or code port was performed.

## 8. Stage 0 evidence summary

```text
Stage: Stage 0 — Freeze and verify current state
Exact SHA: 6214f3dd7aef7a24d33170009164d8f4932ab429
Environment: GitHub main + Vercel staging/production status + Supabase staging/production read-only inventory
Actions completed: main freeze; PR inventory; deployment-status capture; project-binding verification; read-only schema inventory; ledger creation
Tests run: no application tests in Stage 0
Pass totals: 4/4 Vercel contexts success; 2/2 Supabase projects ACTIVE_HEALTHY; staging 9/9 referral tables with RLS; production 0 referral tables
Failures: none
Defects: none opened in Stage 0
Data created: documentation ledger only
Production changed: No
Evidence recorded: this file
Gate result: PASS
Next single action: begin Stage 1 current-main automated regression on exact SHA 6214f3dd7aef7a24d33170009164d8f4932ab429
```

## Stage 0 decision

# PASS

The repository, deployment statuses, environment bindings, referral schema state, and PR boundary are frozen and recorded. Production remains unchanged. Stage 1 may begin only from the exact approved SHA above.
