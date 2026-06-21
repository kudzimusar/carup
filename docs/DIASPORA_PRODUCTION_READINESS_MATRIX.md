# Diaspora Production Readiness Matrix (Gate P)

> Tracks §76–§82 gates. Status: ✅ done / 🟡 in progress / ⬜ not started / 🔒 external-approval-gated.
> Production Supabase `vhmnajoeicasaigiophh` is **forbidden** until explicit release authorization (EB-5).

## §76 Security gate

| Item | Status | Notes |
| --- | --- | --- |
| Credential incident closed | 🔒 CR-1 | Rotate (DB owner) + history purge approval required |
| Secrets rotated | 🔒 | External |
| History remediated | 🔒 | Approval to rewrite + force re-clone |
| Secret scanning expanded | 🟡 | CI secret-scan guard exists; extend to remediated paths |
| Security advisors reviewed | ⬜ | Run after each staging apply |
| RLS reviewed / RPC grants verified | 🟡 | Pattern established (H7 grants); re-verify per new table |
| Rate limits verified | ⬜ | Add for new endpoints (§70) |
| CSRF/CORS/session boundaries | 🟡 | `securityMiddleware.js` exists; verify new routes |
| Upload security verified | ⬜ | XLSX + evidence + dispute uploads (§69) |
| Adversarial review completed | ⬜ | Wave 6 |
| No unresolved high-severity finding | ⬜ | Gate |

## §77 Data gate

| Item | Status | Notes |
| --- | --- | --- |
| Production migration plan reviewed | ⬜ | Build during waves; additive-only |
| Backup confirmed / restore rehearsal | 🔒 | Needs staging/prod access |
| Migration ordering documented | 🟡 | Ledger + runbook |
| Rollback/remediation documented | 🟡 | Rollback runbook scaffolded |
| Data-retention policy documented | ⬜ | |
| Test data excluded | ⬜ | Seeds/QA accounts must not reach prod |
| Reconciliation + post-migration verification | ⬜ | |

## §78 External provider gate

| Provider | Sandbox/Live | Disable switch | Status |
| --- | --- | --- | --- |
| Billing (Phase 8) | sandbox/manual default (impl `billingProvider.js`, live → `EXTERNAL_ACTIVATION_REQUIRED`) | `DIASPORA_BILLING_LIVE` flag, fail-closed | 🟡 sandbox built / 🔒 EB-3 for live |
| Payment/escrow (Phase 9) | sandbox/fake default | feature flag, fail-closed | 🔒 EB-4 |
| Google Drive | mock/disabled | `DIASPORA_DRIVE_ENABLED`, prod-mock blocked | 🔒 EB-2 |
| Email/SMS/WhatsApp | as used | — | ⬜ |
| Malware scan | hook only | — | ⬜ |
| OCR/AI | existing | AI boundary | 🟡 |

## §79 Observability gate
Structured logs, correlation IDs, error tracking, metrics, audit monitoring, webhook-failure alerts,
quota anomalies, payment reconciliation alerts, graph projection lag, Drive sync failures, DB health,
deploy health, dashboards + runbooks — ⬜ (build through waves; correlation IDs already present in
event worker / audit logger).

## §80 Release environments (ordered promotion)
local/test → CI → staging DB (`eoyenigwevnxwwhyhaer`) → staging FE/BE → closed pilot →
🔒 production migration → 🔒 production deploy → smoke → monitored rollout → rollback if gates fail.

## §81 Feature flags (default high-risk external actions DISABLED)

| Flag | Default | Controls |
| --- | --- | --- |
| `DIASPORA_XLSX_ENABLED` | off | XLSX import/export |
| `DIASPORA_DRIVE_ENABLED` | off | live Drive (mock blocked in prod) |
| `DIASPORA_SUBSCRIPTION_ENFORCEMENT` | off→staged | entitlement enforcement |
| `DIASPORA_SAFETRADE_SANDBOX` | off | SafeTrade sandbox |
| `DIASPORA_SAFETRADE_LIVE_PAYMENT` | off (🔒) | real-money payment |
| `DIASPORA_TRADE_GRAPH` | off | graph dashboards |
| `DIASPORA_AI_GRAPH_INSIGHTS` | off | AI graph insights |

(Flag names provisional; implement as env-driven constants per `diasporaDriveConstants.js` pattern.)

## §82 Production smoke tests (post-authorization only)
Auth, tenant isolation, plan/entitlement resolution, quota consumption, workbook template download,
workbook dry-run, stock ledger, RFQ/quote acceptance, AI high-risk block, container capacity,
SafeTrade eligibility, payment provider disabled/sandbox, Drive disabled/live, graph projection/query,
audit events, monitoring alerts, rollback readiness — using synthetic accounts, cleaned up. ⬜

## Final acceptance (Section 86) — summary gate
CI independent pass ⬜ · staging integration pass 🔒EB-1 · security review pass ⬜ · advisors reviewed
⬜ · monitoring/runbooks exist 🟡 · production rehearsal pass 🔒 · no unresolved high-sev ⬜ ·
**final PR remains unmerged until explicit user approval** ✅ (policy).
