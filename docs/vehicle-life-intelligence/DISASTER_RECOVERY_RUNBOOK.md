# Disaster Recovery Runbook (Milestone 6, master plan §12.9)

## Targets

- **RPO (max data loss):** ≤ 15 min for DB (PITR) ; ≤ 24 h for evidence objects (nightly sync) —
  tighten object sync to hourly for production.
- **RTO (max downtime):** ≤ 2 h for API/workers ; ≤ 4 h for full DB restore. Validate against the
  restore test's measured times.

## Incident severity

| Sev | Definition | Response |
|---|---|---|
| SEV1 | Data loss / breach / full outage | page on-call immediately; incident channel; user comms |
| SEV2 | Major degradation (workers stalled, DB read-only) | on-call within 15 min |
| SEV3 | Partial (one provider/adapter down, AI provider outage) | next business hours |

## Runbooks

**DB restore:** see `BACKUP_AND_RESTORE_RUNBOOK.md`. Restore to a new project, verify integrity,
repoint API/workers via env, smoke-test, then cut DNS at Cloudflare. Never restore over prod.

**Storage restore:** restore objects from the independent store; reconcile against
`vehicle_evidence.checksum`; quarantine any object whose checksum mismatches (do not silently serve).

**Region / provider outage:** Fly multi-region or failover region for API+workers; Supabase is the
single DB SPOF — mitigate with PITR + the independent dump (cross-provider). Cloudflare absorbs edge.

**Compromised key:** follow `SECRETS_ROTATION_RUNBOOK.md` emergency rotation; rotate the Supabase
service-role key, invalidate sessions, audit `trust_audit_events` + access logs for misuse.

**Queue backlog recovery:** the outbox/ingestion/AI jobs are durable (DB-backed, `FOR UPDATE SKIP
LOCKED`). On recovery, workers resume; dead-lettered events are replayed via the M6 replay helper.
Watch queue depth/age metrics until drained.

**AI provider outage:** the M3 provider abstraction fails to `manual_review_required` / mock
fallback; no evidence is auto-approved. Jobs retry with backoff; no buyer-facing impact beyond
"analysis pending".

## Communication

- On-call owns the incident; status updates every 30 min (SEV1/2). User-facing notice for any
  data-integrity or availability event affecting buyers/sellers.

## Exercise schedule

- Quarterly restore test (recorded). Annual full DR tabletop (region loss + key compromise).

## External blocker

Failover regions, multi-provider storage, and an on-call/paging tool require accounts/billing and an
ops rota. The runbook is complete; the live drills await that infrastructure.
