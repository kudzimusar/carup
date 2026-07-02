# CarUp Vehicle Life Intelligence & CarVertical-Parity — Program Final Report

**Source of truth:** master plan PR #89. **Authorization boundary honored:** no implementation PR
merged, no production deployment, no production Supabase touched, no secrets printed/committed.

## 1. Executive summary

All six milestones (M1–M6) of the program were implemented as **reuse-first extensions** of the
existing CarUp platform, each in an isolated git worktree, each delivered as a **stacked draft PR**
with migrations, backend services, APIs, frontend, automated tests, and documentation. Work began
with the mandated code-derived discovery & gap audit (Milestone 0). The defining outcome — a
defensible, evidence-linked, chronological account of a vehicle's life with governed human review —
is implemented end-to-end on **sandbox/fixture data + the existing live Gemini OCR**, with AI kept
strictly advisory throughout.

## 2. Current architecture

Monorepo (web · backend · mobile · shared). Express API + service layer over Supabase Postgres
(RLS) + Storage; durable transactional outbox worker. New layers added by this program:
evidence taxonomy + provenance (M1) → external ingestion framework (M2) → durable AI analysis +
temporal + disclosure intelligence (M3) → buyer history report (M4) → governance/dispute/correction
(M5) → production hardening + release docs (M6). See `MILESTONE_0_DISCOVERY_AND_GAP_AUDIT.md` and
`DEPLOYMENT_ARCHITECTURE_ADR.md`.

## 3. Milestone 1–6 status

| MS | Scope | Status | PR |
|---|---|---|---|
| M1 | Evidence taxonomy (8 classes), source registry, evidence sets, provenance, perceptual-hash abstraction, immutable hash-chained chain-of-custody | ✅ Complete | #91 |
| M2 | Provider interface, durable ingestion jobs (idempotency/retry/quarantine/DLQ), identity resolution queue, immutable listing snapshots, sandbox adapter | ✅ Complete (sandbox) | #92 |
| M3 | Durable AI jobs (mock + live Gemini), similarity, same-vehicle confidence, temporal component-change findings, disclosure claim/conflict engine, eval harness | ✅ Complete (advisory) | #93 |
| M4 | Buyer history report (all sections), completeness + limitations, mileage anomaly, versioning, expiring share links | ✅ Complete | #95 |
| M5 | Unified review queue, full decision set, disputes/corrections, reviewer accountability, trust-score separation | ✅ Complete | #96 |
| M6 | PR-gating CI, distributed rate limiting, outbox DLQ, CSRF fix, deployment ADR, WAF, backup/restore + DR + observability + secrets runbooks, release checklist, golden datasets | ✅ Complete (docs + code; live infra = external blockers) | #97 |

## 4. Phase-by-phase completion (Definition of Done)

- **M1 DoD:** 8 classes ✅ · subtypes+validation ✅ · legacy compat ✅ · evidence sets ✅ · source
  registry ✅ · provenance fields ✅ · SHA-256 checksum ✅ (reused) · perceptual-hash abstraction ✅
  (PNG real; other formats honestly "unsupported") · immutable chain-of-custody ✅ · timeline UI ✅
  · public/private serialization tests ✅.
- **M2 DoD:** provider interface ✅ · durable job states ✅ · idempotency/retry/quarantine ✅
  (+DLQ via M6) · identity resolution workflow ✅ · listing snapshots ✅ · ≥1 sandbox adapter
  end-to-end ✅ · imported evidence full provenance ✅ · partner onboarding doc ✅.
- **M3 DoD:** live-provider contract ✅ (Gemini OCR) · mock retained ✅ · OCR tasks + eval ✅
  (mock numbers; live numbers blocked on samples) · viewpoint/component/damage schemas ✅ ·
  near-dup/similarity ✅ · durable analysis jobs ✅ · temporal grouping ✅ · same-vehicle confidence
  ✅ · component-change findings ✅ · before/after UI ✅ · claim extraction ✅ · disclosure conflict
  workflow ✅ · seller response/correction ✅ · public findings governed ✅.
- **M4 DoD:** full report ✅ · timeline/alerts/mileage/ownership/listing/comparison ✅ ·
  completeness + limitations explicit ✅ · evidence/source index ✅ · responsive + accessible ✅ ·
  share/version/correction ✅.
- **M5 DoD:** server-side role enforcement ✅ · review queues ✅ · confirm/reject/amend/inconclusive/
  escalate ✅ · dispute + correction ✅ · reviewer decisions audited ✅ · trust via governed rules ✅
  · public disputed/superseded safe ✅.
- **M6 DoD:** CI gates ✅ · deployment ADR ✅ · durable queue + DLQ ✅ · secrets management ✅
  (rotation runbook; **actual key rotation = external**) · distributed rate limiting ✅ (code;
  Redis = external) · WAF/DDoS documented/deployable ✅ · backups documented + restore-test procedure
  ✅ (execution = external) · DR plan ✅ (drill = external) · observability/alerts mapped ✅ (provider
  = external) · golden datasets defined ✅ · AI quality report ⚠️ (mock; live = external) ·
  security/privacy tests ✅ (in-suite) · perf/resilience ⚠️ (planned) · staging pilot ⛔ (external) ·
  release report ✅ (this doc).

## 5. PR & commit inventory

| PR | Branch | Base | Commits |
|---|---|---|---|
| #89 | docs/vehicle-life-intelligence-master-plan | main | (plan) |
| #91 | feat/vehicle-life-m1-taxonomy-provenance | main | 3 |
| #92 | feat/vehicle-life-m2-ingestion | M1 | 2 |
| #93 | feat/vehicle-life-m3-ai-temporal-disclosure | M2 | 3 |
| #95 | feat/vehicle-life-m4-buyer-report | M3 | 3 |
| #96 | feat/vehicle-life-m5-governance | M3 | 2 |
| #97 | feat/vehicle-life-m6-infra-validation | M3 | 2 |

Note: M4/M5/M6 branch off M3 as siblings. Recommended integration order M1→M2→M3→M4→M5→M6;
retarget each PR to its predecessor as they merge.

## 6. Migration inventory (6, all additive + reversible)

1. `20260621120000_vehicle_life_evidence_taxonomy_provenance.sql`
2. `20260621130000_external_source_ingestion.sql`
3. `20260621140000_ai_temporal_disclosure_intelligence.sql`
4. `20260621150000_report_versions.sql`
5. `20260621160000_governance_disputes_corrections.sql`
6. `20260621170000_outbox_dead_letter.sql`

> **Merge caveat:** migrations were validated by review + the mocked test suite. No local/staging
> Postgres was available in this environment, so they have **not been applied to a real database**.
> Apply + verify on staging before merge-to-main confidence (master plan §19).

## 7. Changed systems

Evidence (`vehicle_evidence` extended), new tables: taxonomy/sources/sets/provenance,
ingestion_jobs/source_records/identity_candidates/listing_snapshots, ai_analysis_jobs/observations/
temporal_findings/disclosure_claims/conflicts, report_versions, review_tasks/decisions/disputes/
dispute_events/trust_change_log, outbox dead-letter. New services: evidence/* , ingestion/* , ai/* ,
intelligence/* , report/* , governance/* . New routers mounted in `server.js`. Frontend: upload
taxonomy fields, life-stage timeline, temporal/disclosure panels, history report + shared page,
governance queue + dispute panel.

## 8. Evidence taxonomy status

✅ Complete — 8 life-stage classes + ~55 subtypes, legacy-13 mapping, validation, discovery API,
seeded `evidence_class_taxonomy`. See `EVIDENCE_TAXONOMY.md`.

## 9. Source/provider status

| Source | Status |
|---|---|
| owner_upload / dealer_upload | **live (first-party)** |
| jp_auction_sandbox | **fixture** — contract-complete adapter, no live API |
| inspection_centre / government_registry_sandbox | **sandbox/unverified** — legal+credential blocked |
| Importer/shipping, insurer/repair | **planned** — interface ready, no adapter yet |

No external provider is represented as live (master plan §2.6). See `SOURCE_PARTNER_ONBOARDING.md`.

## 10. AI provider & evaluation

Gemini 2.5 Flash **live for OCR/document** behind the typed provider abstraction; deterministic
mock retained; vision tasks mock-or-fallback. Eval harness reports per-task metrics; **current
numbers are mock-pipeline validation only** — real accuracy requires running against the live
provider on a consented/synthetic sample set (external: samples + budget). AI is advisory; nothing
auto-approves evidence or changes trust. See `AI_MODEL_AND_EVALUATION_CARD.md`.

## 11. Temporal comparison results

Engine classifies 8 change types across same-vehicle evidence sets with cautious wording,
same-vehicle-confidence gating (≥0.75 to be publishable), and `pending_review` default; before/after
UI shipped. Verified by tests (replaced/newly_damaged/repaired/repaint/missing/unchanged).

## 12. Disclosure-conflict results

Claim extraction from immutable listing snapshots (original text retained) + neutral, evidence-based
conflict classification (supported→strong_conflict), seller response + immutable correction history.
Never accusatory; never auto-published. Verified by tests.

## 13. Buyer report results

Full report assembled with public-safe allowlist: identity, itemized evidence-linked alerts, life
timeline, auction/import/accident/repair/inspection/ownership, mileage history + anomaly, listing
history, before/after, disclosure, completeness indicators, **explicit limitations (missing ≠ clean)**,
evidence/source index; immutable versioning + expiring share links + revoke/correction. Verified by tests.

## 14. Governance & dispute results

Unified review queue; full decision set; disputes (submit→respond→independent review→resolve→appeal);
append-only `review_decisions`/`dispute_events`; reviewer accountability; **trust-score separation**
(trust changes only via `recordGovernedTrustChange`; AI confidence never becomes trust). Verified by
24 governance tests + UI (tsc/build clean).

## 15. Security & privacy results

RLS on all new tables; nothing sensitive exposed to anon; public serialization allowlists strip raw
model output, internal explanations, source credentials, IPs, raw actor IDs; append-only/tamper-evident
provenance + decisions + snapshots; CSRF secret no longer falls back to the service-role key;
secret-scan in CI; no secrets committed. Penetration test = planned (external).

## 16. CI/CD & deployment status

PR-gating CI (`.github/workflows/ci.yml`): web tsc, lint, build, backend `node --test`, secret scan,
npm audit; no auto production deploy. Deployment ADR selects Fly (API+workers) + Cloudflare (WAF) +
Supabase. Branch-protection documented (not auto-applied).

## 17. Queue & worker status

Durable transactional outbox reused + extended with **dead-letter + replay** (M6); ingestion jobs and
AI analysis jobs are durable state machines with retry/backoff. Verified by tests.

## 18. Rate-limiting & WAF status

Pluggable rate-limit store: in-memory default + Redis (`REDIS_URL`, fail-open). Cloudflare WAF/DDoS
config + sample shipped. **Redis + Cloudflare accounts = external blockers.**

## 19. Backup, restore & DR evidence

Runbooks complete with a concrete restore-test procedure (incl. checksum + provenance-chain integrity
verification) and DR plan (RPO/RTO, runbooks, exercises). **Execution requires paid Supabase PITR +
an independent store + failover infra (external).**

## 20. Golden-dataset & staging-pilot evidence

8 golden scenarios defined as a test plan (`GOLDEN_DATASETS.md`); much of the behavior is already
asserted by the automated suites. **Consolidated golden harness + staging pilot = external (infra/
consented data).**

## 21. Remaining risks & external blockers

- Live external provider APIs (auction/import/inspection/government) — credentials + legal agreements.
- Live AI quality numbers — consented/synthetic samples + provider budget.
- Production infra accounts — Redis, Cloudflare zone, Fly org, monitoring/paging, paid Supabase (PITR).
- Rotation of any exposed Supabase service-role key — requires production project access (runbook ready).
- Staging pilot + backup-restore + DR drills — require the above infra + an ops rota.
- Migrations not yet applied to a real DB (no staging Postgres available here).

## 22. Rollback plan

Every migration ships a `-- +migrate Down`; every PR is independently revertible; rate limiter falls
back to in-memory without `REDIS_URL`; live AI falls back to mock without `GEMINI_API_KEY`; imported
evidence is `pending`+`restricted` until governed review. No destructive changes to pre-existing data.

## 23. Final recommendation

**READY FOR MERGE, NOT READY FOR PRODUCTION**

The full feasible Milestone 1–6 implementation is complete, tested, documented, and reviewable as six
stacked draft PRs, with the AI-advisory, evidence-first, governed, and privacy boundaries enforced and
tested. It is **ready for explicit human merge review** (pending a staging migration apply). It is
**not ready for production** until the external blockers in §21 are resolved (provider credentials,
infra accounts, live AI quality numbers, key rotation, backup/DR drills, and a staging pilot).

**No PR was merged and no production deployment occurred. Merge only after the user explicitly states
`merge this PR now`.**
