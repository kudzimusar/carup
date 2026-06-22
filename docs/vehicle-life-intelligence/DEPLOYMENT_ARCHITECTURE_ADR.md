# ADR: Deployment & Hosting Architecture for Vehicle Life Intelligence

- **Status:** Proposed (Milestone 6)
- **Date:** 2026-06-21
- **Owners:** Infrastructure & Release
- **Supersedes / relates to:** `docs/STAGING_ENVIRONMENT.md` (current Vercel + Supabase wiring)
- **Decision drivers:** master plan §12.2–§12.10 (infra, durable workers, queues,
  scheduled ingestion, AI jobs, storage delivery, WAF) and §13 (release gates).

> This ADR evaluates providers on their merits for the Vehicle Life Intelligence
> (VLI) workloads. The current Vercel+Supabase setup is the baseline, not the
> justification — the decision below is argued from workload fit, not "because it
> is already configured."

---

## 1. Context

VLI turns raw vehicle evidence (documents, OCR output, telematics, marketplace
events) into a verifiable, queryable vehicle history. The system today is:

- **Frontend:** Vite/React 19 SPA (`web/`), deployed as static assets on Vercel.
- **API:** Express app (`backend/server.js`, `export default app`) mounted under
  `/api`, served natively by Vercel Functions (no `api/` wrapper).
- **Database + Auth + Storage:** Supabase (Postgres, RLS, Auth, Storage buckets
  for evidence files).
- **Async work today:** a transactional outbox / event worker
  (`backend/services/eventBus/eventWorker.js`) plus in-process telemetry
  (`backend/services/metrics.js`). There is currently **no durable queue and no
  managed scheduler** — this is the principal gap M6 must close on paper.

### Workloads the platform must host

| # | Workload | Characteristics | Today |
| - | -------- | --------------- | ----- |
| W1 | Static frontend (SPA) | Cacheable, global, bursty reads | Vercel static |
| W2 | Express/API (request/response) | Short-lived, auth-gated, RLS-backed | Vercel Functions |
| W3 | Durable background workers | Outbox dispatch, webhook fan-out, trust recalculation; must survive restarts and retry | In-process worker (not durable) |
| W4 | Queues | Decouple ingestion/AI from request path; ordered-ish, at-least-once, DLQ | None (DB-table outbox) |
| W5 | Scheduled ingestion | Periodic pulls (registry/recall/market feeds), nightly audits | None (manual / none) |
| W6 | AI jobs | OCR + fraud + risk scoring; long, costly, rate-limited, external-provider-bound | In-process via `aiServiceBus` |
| W7 | Storage delivery | Evidence images/PDFs; signed URLs, large objects | Supabase Storage |
| W8 | WAF / DDoS | Edge filtering, bot/credential-stuffing controls, rate limits | App-level limiter only |
| W9 | DNS / TLS | Apex + subdomains, automatic certs | Vercel-managed |
| W10 | Regional needs | Primary audience Zimbabwe/diaspora; latency to EU/Africa; data residency expectations | eu/us Supabase region |
| W11 | DB connectivity | Pooled Postgres connections from serverless | Supabase pooler |

---

## 2. Options considered

Each provider is scored against the workloads. Ratings: **Strong / Adequate /
Weak / N/A**.

### 2.1 Vercel

| Workload | Fit | Notes |
| -------- | --- | ----- |
| W1 Frontend | **Strong** | Best-in-class static/edge CDN, instant rollbacks, preview deploys. |
| W2 API | **Adequate** | Express runs as Functions, but functions are request-scoped and time-limited; cold starts and execution caps constrain long calls. |
| W3 Durable workers | **Weak** | No always-on process. Vercel Cron + Functions can simulate, but each invocation is bounded; long retries/backoff are awkward. (Vercel's newer durable-workflow primitives exist but are not adopted here.) |
| W4 Queues | **Weak** | No native managed queue; would require a marketplace add-on. |
| W5 Scheduled ingestion | **Adequate** | Vercel Cron triggers Functions on a schedule, but each run inherits Function time limits. |
| W6 AI jobs | **Weak** | Long, costly jobs do not fit short Function budgets; risk of timeouts mid-OCR/fraud pass. |
| W7 Storage | **N/A** | Defers to Supabase / Blob. |
| W8 WAF/DDoS | **Strong** | Automatic DDoS mitigation + configurable WAF (managed rulesets, custom rules, rate limiting, Attack Mode) at the edge. |
| W9 DNS/TLS | **Strong** | Automatic certs, apex + subdomain management. |
| W10 Regional | **Strong** | Global edge; functions pinned to a region near Supabase. |
| W11 DB connectivity | **Adequate** | Works via Supabase pooler; serverless connection churn needs the transaction pooler. |

### 2.2 Cloudflare

| Workload | Fit | Notes |
| -------- | --- | ----- |
| W1 Frontend | **Strong** | Pages + global CDN. |
| W2 API | **Adequate** | Workers are fast and global but the Node/Express app would need adaptation; Workers are not a drop-in Express host. |
| W3 Durable workers | **Adequate→Strong** | Durable Objects + Workers give long-lived, stateful coordination, but are a different programming model than the existing Express services. |
| W4 Queues | **Strong** | Cloudflare Queues: managed, at-least-once, batching, DLQ. |
| W5 Scheduled ingestion | **Strong** | Cron Triggers for Workers. |
| W6 AI jobs | **Adequate** | Workers have CPU/time limits; long AI passes need chunking or an external runner. |
| W7 Storage | **Strong** | R2 (S3-compatible, zero-egress) is attractive for evidence delivery, but evidence currently lives in Supabase Storage with RLS-aligned access. |
| W8 WAF/DDoS | **Strong** | Industry-leading managed WAF, bot management, rate limiting, L3/4 + L7 DDoS. |
| W9 DNS/TLS | **Strong** | Authoritative DNS + universal SSL; natural place to terminate. |
| W10 Regional | **Strong** | Largest edge footprint incl. Africa PoPs (good for ZW/diaspora). |
| W11 DB connectivity | **Adequate** | Workers ↔ Postgres needs Hyperdrive or the Supabase pooler. |

### 2.3 Fly.io

| Workload | Fit | Notes |
| -------- | --- | ----- |
| W1 Frontend | **Adequate** | Can serve static, but a CDN is better suited. |
| W2 API | **Strong** | Runs the Express app **unmodified** as a long-lived process in a container, region-pinnable. No Function time caps. |
| W3 Durable workers | **Strong** | Always-on machines / worker processes; natural home for the outbox dispatcher, webhook fan-out, trust recalculation. |
| W4 Queues | **Adequate** | No native managed queue, but can run Redis/NATS, or pair with an external managed queue. |
| W5 Scheduled ingestion | **Strong** | Long-running scheduler process or Fly Machines cron; no per-run time cap. |
| W6 AI jobs | **Strong** | Long, costly jobs run comfortably on a dedicated worker machine with concurrency/cost control. |
| W7 Storage | **N/A** | Defers to Supabase. |
| W8 WAF/DDoS | **Weak** | Basic platform protection only; needs an edge in front (Cloudflare). |
| W9 DNS/TLS | **Adequate** | Certs supported; usually fronted by another DNS/edge. |
| W10 Regional | **Strong** | Can deploy in a region close to Supabase and to users (e.g., `fra`/`jnb`). |
| W11 DB connectivity | **Strong** | Long-lived process holds a real pooled connection — best fit for Postgres. |

### 2.4 Supabase

| Workload | Fit | Notes |
| -------- | --- | ----- |
| W1 Frontend | **N/A** | Not a frontend host. |
| W2 API | **Adequate** | Edge Functions (Deno) for small endpoints; not a host for the full Express app. |
| W3 Durable workers | **Weak** | No general worker runtime; `pg_cron` covers scheduled SQL only. |
| W4 Queues | **Adequate** | `pgmq` (Postgres message queue) provides a transactional, DB-native queue — well aligned with the existing outbox pattern. |
| W5 Scheduled ingestion | **Adequate** | `pg_cron` + `pg_net` can trigger periodic jobs/HTTP calls. |
| W6 AI jobs | **Weak** | Edge Functions are time/memory limited; not for long AI passes. |
| W7 Storage | **Strong** | Storage buckets with RLS, signed URLs, image transforms — already the system of record for evidence. |
| W8 WAF/DDoS | **Weak** | Platform-level only; not a configurable WAF. |
| W9 DNS/TLS | **N/A** | Managed for its own endpoints only. |
| W10 Regional | **Adequate** | Single primary region per project; read replicas available on higher tiers. |
| W11 DB connectivity | **Strong** | It *is* the database; supavisor pooler handles serverless churn. |

---

## 3. Decision

Adopt a **best-of-breed split with Cloudflare at the edge** rather than a single
provider:

1. **Frontend (W1):** **Vercel** for the SPA. It is the strongest static/edge
   host with first-class preview deploys and instant rollback, and rollback speed
   is a release-gate requirement (§13). (Cloudflare Pages is the documented
   fallback if we want a single-vendor edge.)
2. **API + durable workers + scheduler + AI jobs (W2, W3, W5, W6):** **Fly.io**,
   running the existing Express app and dedicated worker/scheduler processes as
   long-lived containers. This is the decisive change: serverless Functions are a
   **poor fit for durable workers and long AI jobs**, which are core to VLI.
   Fly.io runs the current code with minimal change and removes Function time
   caps.
3. **Queue (W4):** **Supabase `pgmq`** as the managed, transactional queue,
   consumed by the Fly.io worker. Rationale: it is transactional with the same
   Postgres that holds the outbox and `trust_*` tables, preserving exactly-once-ish
   semantics with the existing event model and avoiding a second datastore.
   (Cloudflare Queues is the documented escalation path if throughput outgrows
   `pgmq`.)
4. **Scheduled ingestion triggers (W5):** **Supabase `pg_cron` + `pg_net`** to
   enqueue ingestion jobs into `pgmq`; the Fly.io worker executes them. This keeps
   scheduling transactional and observable in the DB.
5. **Database, Auth, Storage (W7, W11):** **Supabase** remains the system of
   record. Evidence stays in Supabase Storage (RLS-aligned, signed URLs), which
   keeps access control unified with row-level security.
6. **WAF / DDoS / DNS / TLS (W8, W9):** **Cloudflare** in front of both Vercel
   and Fly.io. Cloudflare provides the strongest managed WAF, bot management, and
   rate limiting, and becomes the authoritative DNS + TLS termination point. See
   `WAF_DDOS_CONFIG.md`.
7. **Regional (W10):** Pin Fly.io and the Supabase project to the **same region**
   closest to the Postgres primary (e.g., `fra`), and rely on Cloudflare's global
   edge (incl. African PoPs) to keep latency low for ZW/diaspora users.

### Operating model summary

```
                 ┌──────────────── Cloudflare (DNS, TLS, WAF, DDoS, rate limits) ─────────────┐
 Users  ───────▶ │  edge filter ▶ bot/credential-stuffing ▶ rate-based rules ▶ logging        │
                 └───────┬───────────────────────────────────────────────┬───────────────────┘
                         │ (static)                                       │ (/api/*)
                         ▼                                                ▼
                  Vercel (SPA)                                   Fly.io (Express API)
                                                                        │
                          enqueue ┌──────────────────────────────┐     │ read/write (pooled)
                                  ▼                                ▼    ▼
                       Supabase pgmq  ◀── pg_cron/pg_net      Supabase Postgres (RLS)
                                  │                                ▲
                                  ▼                                │
                       Fly.io worker (durable):  outbox dispatch · webhooks ·
                       trust recalc · AI jobs (OCR/fraud/risk) ───┘
                                  │
                                  ▼
                         Supabase Storage (evidence, signed URLs)
```

---

## 4. Consequences

**Positive**

- Durable workers, queues, scheduled ingestion, and long AI jobs get a runtime
  that actually fits them (Fly.io long-lived processes) instead of being shoehorned
  into time-capped Functions.
- One edge (Cloudflare) owns WAF/DDoS/DNS/TLS, so security policy lives in one
  place and protects both the SPA and the API.
- The queue (`pgmq`) and scheduler (`pg_cron`) stay transactional with the
  existing Postgres/outbox model — minimal new operational surface, no second
  datastore to back up.
- Evidence access control stays unified under Supabase RLS + signed URLs.

**Negative / costs**

- Three vendors to operate (Vercel, Fly.io, Cloudflare) + Supabase. More config
  surface; mitigated by the runbooks in this directory.
- Migrating the API from Vercel Functions to a Fly.io long-lived process is real
  work (Dockerfile, health checks, pooled DB connection management, deploy
  pipeline). Until that lands, the API remains on Vercel Functions as the
  documented interim.
- `pgmq` couples queue throughput to the primary DB; if AI ingestion volume
  spikes, escalate to Cloudflare Queues per the path above.

**Interim state (until Fly.io migration lands)**

- API stays on Vercel Functions; long AI jobs must remain chunked/bounded.
- Cloudflare can still be placed in front for WAF/DNS/TLS immediately, ahead of
  the worker migration.

---

## 5. Alternatives rejected

- **All-Vercel:** rejected. Strong for W1/W8/W9 but Weak for durable workers,
  queues, and long AI jobs (W3/W4/W6) — the workloads that define VLI.
- **All-Cloudflare (Workers + Queues + R2 + D1/Hyperdrive):** strong edge and
  queueing, but requires rewriting the Express services to the Workers model and
  moving evidence off Supabase Storage (losing the unified RLS story). Kept as the
  documented escalation/fallback, not the initial decision.
- **All-Supabase (Edge Functions + pgmq + pg_cron + Storage):** great for
  DB-native queue/schedule/storage, but Edge Functions cannot host the full
  Express app or long AI jobs (W2/W6 Weak) and offer no real WAF (W8 Weak).

---

## 6. Follow-ups

- [ ] Author the Fly.io `Dockerfile` + `fly.toml` for the API and worker (owned by
      the code agent; out of scope for this docs-only milestone).
- [ ] Stand up Cloudflare zone, apply `infra/cloudflare-waf.sample.json`, point
      DNS at Vercel (SPA) and Fly.io (API).
- [ ] Enable `pgmq` + `pg_cron` + `pg_net` extensions in Supabase (migration owned
      by the code/DB agent).
- [ ] Wire `eventWorker.js` to consume from `pgmq` instead of polling the outbox
      table directly.
