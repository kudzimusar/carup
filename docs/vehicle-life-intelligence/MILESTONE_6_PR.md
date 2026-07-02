# Milestone 6 PR — Production Infrastructure, Hardening & Release Readiness

**Branch:** `feat/vehicle-life-m6-infra-validation` → base `feat/vehicle-life-m3-ai-temporal-disclosure`
**Program:** Vehicle Life Intelligence (master plan PR #89, §12–§13)
**Status:** Draft. **Do not merge** without explicit `merge this PR now`.

## Exact scope

Production hardening + release-readiness: PR-gating CI, distributed rate limiting, outbox
dead-letter handling, a CSRF-secret safety fix, and the full operational runbook/ADR set
(deployment, WAF/DDoS, backup/restore, DR, observability, secrets rotation, release checklist,
golden datasets).

## Code (tested)

- `backend/middleware/rateLimitStore.js` — pluggable rate-limit store: in-memory default
  (unchanged behavior) + optional Redis (`REDIS_URL` + injected client); fails OPEN on store I/O.
- `backend/middleware/securityMiddleware.js` — uses the pluggable store; CSRF/JWT signing now
  requires `JWT_SECRET` and no longer falls back to the Supabase service-role key (fail-safe in prod).
- `backend/services/eventBus/eventWorker.js` + `database/migrations/20260621170000_outbox_dead_letter.sql`
  — dead-letter state after max attempts + replay helper.
- Tests: `rate-limit-store.test.js`, `outbox-dead-letter.test.js` — **16 pass** (verified in-repo;
  diaspora CSRF flow regression green).

## CI + infra/docs

- `.github/workflows/ci.yml` — PR-gating: web tsc, lint, build, backend `node --test`, secret scan
  (gitleaks + grep fallback), npm audit (advisory). No auto production deploy.
- `infra/cloudflare-waf.sample.json` + `WAF_DDOS_CONFIG.md` — deployable WAF/DDoS/rate config.
- `DEPLOYMENT_ARCHITECTURE_ADR.md` — Fly (API+workers) + Cloudflare (WAF) + Supabase decision.
- `BACKUP_AND_RESTORE_RUNBOOK.md` (with a concrete restore test + integrity verification),
  `DISASTER_RECOVERY_RUNBOOK.md` (RPO/RTO, runbooks, exercises),
  `OBSERVABILITY_AND_ALERTS.md` (signals→alerts→owners on the existing metrics hub),
  `SECRETS_ROTATION_RUNBOOK.md` (incl. exposed service-role-key rotation — procedure only, no secrets),
  `RELEASE_CHECKLIST.md`, `GOLDEN_DATASETS.md` (8 scenarios).

## Security / privacy

- No secrets committed (`.env*` gitignored; CI uses test placeholders; docs contain procedures only).
- CSRF secret hardening removes the service-role-key fallback.
- Distributed limiting + WAF give cross-instance abuse protection.

## Rollout / rollback

- **Rollout:** merge CI first; apply the additive DLQ migration; set `REDIS_URL` + apply WAF in
  staging before production. **No automatic production deploy.**
- **Rollback:** revert branch; DLQ migration has a `-- +migrate Down`; rate limiter falls back to
  in-memory without `REDIS_URL`.

## Remaining external blockers (cannot be closed without accounts/credentials/decisions)

- Redis provider, Cloudflare zone, Fly org, monitoring/paging account, paid Supabase tier (PITR +
  independent backup store) — all account/billing-gated.
- Live AI quality numbers (samples + budget); staging pilot + DR drills (infra + ops rota);
  rotating the actual exposed service-role key (prod project access).
These are documented and deployable/testable in staging; production execution awaits authorization.
