# Release Checklist & Gate (Milestone 6, master plan §13.7)

Production readiness requires every item below satisfied or recorded as an explicit external blocker.
**No production merge/deploy without explicit user authorization** (`merge this PR now`).

## Gate items

- [ ] All milestone PRs (M1–M6) reviewed and approved.
- [ ] CI green on the merge commit: web tsc, lint, build, backend `node --test`, secret scan, audit.
- [ ] Migrations applied to **staging** and verified (no drift); rollback (`-- +migrate Down`) tested.
- [ ] AI quality report run against the **live** provider on the golden/eval set; per-task thresholds met (`AI_MODEL_AND_EVALUATION_CARD.md`). *(blocker: live samples + budget)*
- [ ] Security validation: dependency + secret scan clean; auth/RLS review; signed-URL + upload review; public-API privacy review; rate-limit + WAF test; prod headers/CORS verified.
- [ ] Backup configured + **restore test** completed with integrity verification (`BACKUP_AND_RESTORE_RUNBOOK.md`). *(blocker: paid tier)*
- [ ] DR plan + exercise completed (`DISASTER_RECOVERY_RUNBOOK.md`). *(blocker: failover infra/on-call)*
- [ ] Observability + alerts wired to a provider with owners (`OBSERVABILITY_AND_ALERTS.md`). *(blocker: monitoring account)*
- [ ] Distributed rate limiting active (`REDIS_URL`) + WAF/DDoS applied in staging. *(blocker: Redis + Cloudflare accounts)*
- [ ] Exposed Supabase service-role key rotated via `SECRETS_ROTATION_RUNBOOK.md`. *(blocker: prod project access)*
- [ ] Golden datasets pass end-to-end (`GOLDEN_DATASETS.md`).
- [ ] Staging pilot completed with consented/synthetic vehicles (import → review → AI → temporal →
      conflict → report → dispute → correction → buyer view) + operational metrics captured.
- [ ] Performance/resilience tests: concurrent uploads, large histories, queue backlog, provider
      timeout, storage failure, retry/idempotency, degraded report generation.
- [ ] Rollback plan documented per PR; deployment ADR accepted (`DEPLOYMENT_ARCHITECTURE_ADR.md`).

## Final recommendation (choose one)

- `READY FOR EXPLICIT MERGE AND CONTROLLED PRODUCTION PILOT`
- `READY FOR MERGE, NOT READY FOR PRODUCTION`
- `NOT READY — BLOCKERS REMAIN`

See the program final report for the current recommendation and the live list of external blockers.
