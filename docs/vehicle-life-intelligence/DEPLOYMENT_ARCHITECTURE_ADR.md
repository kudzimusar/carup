# ADR: Deployment Architecture for Vehicle Life Intelligence (Milestone 6)

**Status:** Proposed (master plan §12.3). **Decision owner:** platform lead. Requires user approval before any production change.

## Context

The platform = Vite/React web, an Express API (`backend/server.js`), durable workers
(`eventBus/eventWorker.js` transactional outbox + the new ingestion/AI jobs), Supabase Postgres
+ Storage, and AI providers (Gemini live for OCR). Workloads added by M1–M5: source ingestion
(scheduled/polling), durable AI analysis jobs, report generation, and review/notification flows.

## Workload requirements

| Workload | Shape | Needs |
|---|---|---|
| Web (SPA) | static + edge | CDN, cheap, global |
| Express API | request/response, bursty | Node 20, autoscale, regional near DB |
| Durable workers (outbox, ingestion, AI jobs) | long-running, retried | always-on process(es), not per-request |
| Scheduled ingestion | cron | reliable scheduler |
| AI jobs | I/O-bound, cost-metered | concurrency limits, budget caps |
| Storage delivery | signed URLs | private buckets + CDN |
| DB | Postgres + RLS | PITR, connection pooling |
| Edge protection | WAF/DDoS | managed rules, rate limiting |

## Options considered

1. **Vercel (current web+API) + Supabase + Cloudflare in front.** Web on Vercel CDN; API as
   Vercel Functions; **workers do NOT fit Vercel's request model** (no always-on process) — would
   need cron-triggered function invocations of the outbox/job tables (works, but adds latency and
   per-invocation limits). Cloudflare for WAF/DDoS.
2. **Fly.io for API + workers, Vercel/Cloudflare Pages for web, Supabase DB, Cloudflare WAF.**
   Fly runs always-on machines (API + a dedicated worker process consuming `domain_events`,
   `ingestion_jobs`, `ai_analysis_jobs`), regional near the DB; Cloudflare in front for WAF/DDoS,
   origin shielding, TLS.
3. **Single VPS / container host.** Cheapest but worst for resilience, scaling, and ops.

## Decision

**Adopt Option 2 for the durable-worker workloads while keeping the web on a CDN host.**
- **Web:** Cloudflare Pages or Vercel (CDN) — either is fine; keep current Vercel web unless cost/edge
  dictates otherwise.
- **API + workers:** **Fly.io** — one app for the Express API (autoscaled) and a **separate worker
  process group** that runs the outbox poller + ingestion + AI job runners. This matches the
  durable-job design (`FOR UPDATE SKIP LOCKED`, retries, dead-letter) which needs always-on
  processes, not per-request functions.
- **Edge:** **Cloudflare** in front of the API for WAF, DDoS mitigation, rate-based rules, and
  origin shielding (see `WAF_DDOS_CONFIG.md`). Pair with the new distributed rate-limit store
  (`REDIS_URL`) for cross-instance limits.
- **DB + Storage:** **Supabase** (Postgres + RLS + Storage), with PITR enabled and a pooled
  connection string for the API/workers.
- **AI:** keep Gemini behind the M3 provider abstraction with budget caps + the durable job model.

Rationale: the program's new value (ingestion, AI jobs, report generation) is worker-shaped, and
Vercel's function model fights that. Fly gives always-on workers near the DB; Cloudflare gives the
WAF/DDoS layer the plan requires. **We do NOT pick a platform merely because it is already
configured** (master plan §12.3).

## Consequences

- Need a Redis (Upstash/Fly Redis) for distributed rate limiting + (optionally) a job broker.
- Need a worker Dockerfile/process and a Fly `processes` config (API + worker).
- DNS/TLS managed at Cloudflare; origin locked to Cloudflare IPs.
- Migration path: stand up Fly API+worker in staging, cut DNS via Cloudflare, validate, then
  promote with explicit approval. **No automatic production cutover.**

## Open items requiring a decision/credentials (external blockers)

- Cloudflare account + zone; Fly.io org; Redis provider — all require accounts/billing.
- Final web host (Vercel vs Cloudflare Pages) — cost/edge decision.
