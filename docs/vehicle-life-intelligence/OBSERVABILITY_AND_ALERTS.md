# Observability & Alerts (Milestone 6, master plan §12.10)

Builds on the existing `backend/services/metrics.js` hub, structured logger
(`backend/utils/logger.js`, secret-redacting), and correlation IDs
(`backend/middleware/correlationMiddleware.js`). The hub is exposed via `/api/health`.

## Signals → alerts

| Signal (source) | Threshold (alert) | Owner / runbook |
|---|---|---|
| API error rate (`metrics` API counters) | > 2% over 5 min | on-call → DR runbook |
| API p95 latency (telemetry middleware) | > 1.5 s over 10 min | on-call |
| Evidence upload failures | > 5% over 10 min | evidence owner |
| Ingestion lag / `ingestion_jobs` stuck in `running` | age > 30 min | ingestion owner → onboarding doc |
| Outbox/job queue depth & age (`metrics` outbox) | depth > 100 or oldest > 15 min | on-call → DR "queue backlog" |
| Dead-letter count (`domain_events` dead_letter) | any new > 0 | on-call (replay helper) |
| AI job success/cost/latency (`ai_analysis_jobs`) | success < 90% OR daily cost > budget | AI owner → AI eval card |
| Review-queue age (`review_tasks` pending) | oldest > 48 h | governance owner |
| Report generation failures | any sustained | report owner |
| Source adapter health | repeated `failed_terminal`/`dead_letter` | source-partner owner |
| Rate-limit / WAF events (Cloudflare Logpush + app limiter) | spike vs baseline | security owner → WAF doc |
| DB / storage health (`/api/health` supabase status) | unhealthy | on-call → DR runbook |
| Backup success | nightly job missed | platform owner → backup runbook |
| Release health (post-deploy error/latency) | regression vs pre-deploy | release owner → rollback |

## Implementation notes

- Ship logs + metrics to a provider (Sentry for errors — `sentry.js` already has a fallback;
  Logpush → a log store; a metrics scrape of `/api/health` or push to a TSDB).
- Every alert links to an owner + a runbook section (above). Correlation IDs tie an alert back to
  request traces and `trust_audit_events`.

## External blocker

A metrics/alerting backend (Sentry/Datadog/Grafana) + paging require accounts/billing. The signals
exist in code today; wiring them to a provider + alert rules is the remaining (account-gated) step.
