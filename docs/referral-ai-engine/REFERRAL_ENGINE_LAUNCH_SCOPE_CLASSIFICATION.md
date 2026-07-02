# Referral Engine — Launch-Scope Classification

Branch: `feat/referral-final-uat-release` · PR #88 · 2026-06-21

This document reconciles the TRD 00–12 coverage audit (301 requirements: PASS 203,
PARTIAL 78, MISSING 15, BLOCKED 2, DEFERRED 3) against the **launch gates** defined
by `REFERRAL_ENGINE_FINAL_UAT_RELEASE_GOAL_LOOP.md` (phases F1–F7) and the original
acceptance principle: *"a referred user can enter from a social channel, create a
verified lead or transaction path, retain attribution, produce a reviewable benefit
record, and leave a complete event trail."*

Each PARTIAL/MISSING item is classified **LAUNCH_REQUIRED** (must ship for launch →
implement) or **FUTURE_ROADMAP** (genuine future scope → owner-approval-required
deferral, not a completed feature). Nothing is silently "justified."

## Launch-required core (status: implemented; live proof BLOCKED on staging secret)

The F1–F7 launch scope is the reward loop and its admin/owner surfaces:
code/campaign/coupon/share-asset → lead → qualification → **correct-owner** wallet
reward → dispute → resolution → audit checksum; local + vehicle/parts/container
import flows; capacity/waitlist; marketing draft→review→approved→scheduled→published;
trust risk/hold/override; authorization & tenant boundaries; owner web + mobile-owner
journey. **All of this is implemented and PASS in the matrix**, with the critical
wallet-attribution defect fixed and proven by tests. The only outstanding
launch-required item is the **live** end-to-end proof, which is BLOCKED on the
staging `service_role` key (see §Blocked).

## MISSING items — classification

| MISSING requirement | TRD basis | Class | Resolution |
|---|---|---|---|
| QR/barcode scans create referral events | 02 | **LAUNCH_REQUIRED** | **RESOLVED** — `QR_SCANNED`/`BARCODE_SCANNED` now emitted on scan-channel validation (commit `1cf6165`, tested) |
| Last-touch attribution events | 02 | FUTURE_ROADMAP | First-touch code-owner attribution (the reward-bearing model) is implemented & proven; multi-touch is an analytics enhancement. Owner-approval-required. |
| Assisted-touch attribution events | 02 | FUTURE_ROADMAP | Same as above. |
| Zimbabwe receiver role | 01 | FUTURE_ROADMAP | The receiver is a diaspora-shipment recipient (fields exist in reservations), not a referral actor with a wallet; not a reward-loop role in F1–F7. |
| AI creates listings / describes parts / drafts listing text | 00/07 | FUTURE_ROADMAP | AI content-generation is the broader AI-first vision; the gateway ships safe triage + a core tool catalogue with audited execution, which is the F1–F7-relevant capability. |
| Gateway tool: create_lead | 07 | FUTURE_ROADMAP | Leads are created via the local/import services + routes; an agent-callable tool is an incremental gateway addition on an extensible framework. |
| Gateway tool: create_listing_draft | 07 | FUTURE_ROADMAP | Depends on AI listing generation (future). |
| Gateway tool: reserve_container_interest | 07 | FUTURE_ROADMAP | Container interest is captured via import lead/capacity flows; agent tool is incremental. |
| Gateway tool: request_quote | 07 | FUTURE_ROADMAP | Incremental gateway tool. |
| Gateway controls retries | 07 | FUTURE_ROADMAP / N-A | The gateway is deterministic rule-based, not an external-LLM caller — there is no provider call to retry. Applies only if/when an LLM backend is integrated. |
| Gateway controls provider fallback | 07 | FUTURE_ROADMAP / N-A | Same — no external provider to fall back from. |
| Assistant surface: Admin copilot | 08 | FUTURE_ROADMAP | Admin reaches the gateway via API today; a dedicated copilot UI surface is future scope. |
| Mobile access to local-marketplace flows | 01 | FUTURE_ROADMAP | Mobile is owner-focused by design in the UAT plan (wallet, share, dispute); admin/operator local management is web. |
| Mobile support for import campaigns | 01 | FUTURE_ROADMAP | Same — mobile owner-focused; admin import management is web. |

**Net: 1 launch-required MISSING (QR/barcode) — RESOLVED. The remaining 13 are FUTURE_ROADMAP owner-approval-required deferrals.**

## Specifically-named previously-deferred items

| Item | Class | Reason |
|---|---|---|
| Zimbabwe receiver role | FUTURE_ROADMAP | Not a wallet-bearing referral actor; diaspora-module concept. |
| Ambassador grouped campaigns / dashboard | FUTURE_ROADMAP | Ambassadors ARE supported as code/bundle owners and earn rewards (PASS); a grouped-campaign dashboard UI is an enhancement, not an F1–F7 gate. |
| Supplier/mechanic referral journey | FUTURE_ROADMAP | Participant types exist and the find_parts/service reward loop works; a dedicated specialized journey UI is roadmap. |
| Admin-created invitation workflow | FUTURE_ROADMAP | Admin creates codes/bundles today (PASS); a distinct invitation flow is not an F1–F7 launch gate. |
| Additional gateway tools | FUTURE_ROADMAP | Extensible catalogue; core tools present and audited. |
| Admin copilot | FUTURE_ROADMAP | Gateway API accessible to admin; copilot UI is future. |
| Cross-surface continuation | FUTURE_ROADMAP | The launch plan requires same-user continuation "where implemented"; attribution carries via code/session today. Full continuation is roadmap. |
| Multi-touch attribution | FUTURE_ROADMAP | First-touch is the reward model and is proven; multi-touch is analytics. |
| Mobile admin operations | FUTURE_ROADMAP | Mobile is owner-focused by design. |

None of the named items is an F1–F7 launch gate; all are recorded as
**owner-approval-required roadmap deferrals**, not completed features.

## PARTIAL items (78)

PARTIAL items fall into three buckets, none launch-blocking:
1. **Live-round-trip BLOCKED** — implemented and unit-tested under an in-memory
   repository, but the real staging round-trip (DB constraints, webhooks) is
   unverifiable without the staging secret. These flip to PASS once live UAT runs.
2. **Role-modeling nuance** — e.g. buyer/seller exist as participant_types but not
   as separate platform auth roles; the authz boundary that matters for launch
   (owner cannot reach admin) HOLDS and is tested.
3. **Enhancement surface** — partial UI/telemetry depth that exceeds the F1–F7
   acceptance bar.

The per-item PARTIAL gap is recorded in the coverage matrix's Note column.

## Blocked (the only launch-required outstanding item)

Live correct-owner wallet attribution + the other live journeys are BLOCKED on the
staging `service_role` key (unavailable via shell env, `.env` placeholders, Supabase
CLI/MCP [different account], and Vercel [Sensitive-redacted]). The executable runner
proves all of it in one command once the key is provided.

## Verdict

Launch-required functional scope is implemented and (unit/integration) tested; the
single launch-required MISSING item (QR/barcode events) is RESOLVED. The remaining
MISSING/PARTIAL items are FUTURE_ROADMAP or live-blocked. **Readiness is gated only
on the live staging proof.**
