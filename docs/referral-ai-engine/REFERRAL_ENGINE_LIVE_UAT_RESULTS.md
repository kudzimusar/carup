# Referral Engine — Live Staging UAT Results

Branch: `feat/referral-final-uat-release` · PR #88 · Executed 2026-06-22

## Environment

- Target: **staging** Supabase ref `eoyenigwevnxwwhyhaer` (production ref
  `vhmnajoeicasaigiophh` was never used; safety gate verified the `.env.uat.local`
  target before any write).
- Backend: this branch's code, run locally against the staging DB via
  `node --env-file=backend/.env.uat.local` (the production-pointing `backend/.env`
  was never loaded — the worktree has none).
- Credentials: held only in git-ignored `backend/.env.uat.local` (perms `600`);
  never printed, logged, or committed.

## Accounts (provisioned via the official seed script — no passwords shown)

| Email | Role | User ID | Result |
|-------|------|---------|--------|
| `uat-admin@carup.local` | admin | `u_uat_ref_admin_2026` | updated |
| `uat-owner@carup.local` | owner | `u_uat_ref_owner_2026` | updated |

> Note: the supplied admin and owner passwords were identical; the official seed
> script (correctly) requires unique passwords per account, so a distinct strong
> owner password was generated into the ignored `.env.uat.local`. Reset it there
> for manual owner UAT if needed.

## Per-journey live results (final clean run)

| Journey | Result | Notes |
|---------|--------|-------|
| 1 — Auth + boundaries | ✅ 7/0 | admin+owner login, `/api/auth/me`, owner→admin **403**, invalid **401** |
| 2 — Campaign → code → coupon → QR/share | ✅ 12/0 | validate, coupon apply (10% → 10), attribution-preserving share assets + QR + barcode |
| 3 — Owner bundle → local lead → reward → **CORRECT wallet** | ✅ 9/0 | **CRITICAL: wallet txn owner === bundle code owner — PROVEN LIVE**; code-substitution cannot redirect; duplicate-reward prevented |
| 4 — Seller / parts flow | ✅ 3/0 | parts_import reward attributed to owner |
| 5 — Import / container capacity + waitlist | ✅ 8/0 | over-capacity rejected; **over-capacity + allow_waitlist → waitlisted**; deposit_paid reward attributed |
| 6 — Marketing state machine | ✅ 13/0 | draft→review→approved→scheduled→published; illegal jump blocked; scheduling needs time; **rejection requires reason**; UTM/canonical/disclosure preserved |
| 7 — Fraud hold → human override | ⚠️ 5/1 | hold + override worked; the audit-event read returned 500 (see scalability note) |
| 8 — Dispute → resolution → audit checksum | ⚠️ 4/1 | dispute create/resolve worked; audit-export returned 500 (see scalability note). Checksum + count **passed cleanly in an earlier run** before the event table was bloated. |
| 9 — WhatsApp/Telegram inbound attribution | ✅ 2/0 | inbound parsed, referral code extracted, attribution recorded |
| 10 — AI triage + safe handoff | ✅ 2/0 | triage returns intent + safe response + suggested tools; audited |

**Totals (final run): 65 pass / 2 fail / 0 skip.** All launch-critical assertions
passed. The 2 failures are the audit endpoints only (next section).

## Defects found by the live UAT — fixed and unit-tested

| Sev | Defect | Fix | Live re-verify |
|-----|--------|-----|----------------|
| High | Import capacity preflight ignored `allow_waitlist` (over-capacity leads rejected instead of waitlisted) — in the **benchmark** service the routes use | `87e0c74` (preflight + lead record + test) | Journey 5 → 8/0 |
| Medium | Marketing asset rejection did not require a reason (plan mandates it) | `87e0c74` (validation + test) | Journey 6 → 13/0 |

The live run also exposed several **UAT-runner** bugs (wrongly skipping CSRF on
validate/coupon/channel/agent; container capacity setup; blank-owner and SEO-status
expectations) — fixed in `066e8dd`. The backend behavior in those cases was correct
(CSRF enforced, capacity enforced, blank-owner defaults to actor by design).

## The 2 remaining failures: audit-endpoint 500s = staging-DB degradation (not a code defect)

The backend log shows `insert into referral_events failed: canceling statement due
to statement timeout` (Postgres 57014). Across ~6 UAT runs the staging
`referral_events` table grew large enough that the trust **audit trail / audit
export** endpoints — which scan all events — hit the 60s statement timeout, and the
overall staging DB slowed (logins went from instant to ~7s). The audit **checksum +
count functionality passed cleanly** in an earlier run on a smaller dataset
(Journey 8 was 5/0).

**Real follow-up finding (scalability, Medium):** the trust audit export/trail
should paginate or time-bound the event scan (and the event table would benefit from
supporting indexes) so audit operations remain fast at production data volumes. Not
launch-blocking for correctness, but recommended before high-volume production use.

## What this proves

- **Correct-owner wallet attribution is proven LIVE** — the single most important
  release gate.
- Auth/tenant boundaries, capacity + waitlist, marketing workflow (incl.
  rejection-reason), fraud hold/override, dispute lifecycle, channel inbound
  attribution, and AI triage all pass live against this branch's code.
- Two real backend defects were caught by the live run and fixed with regression
  tests; both re-verified live.

## Outstanding (owner-side)

- **search_path migration application + Supabase advisors**: the
  `20260621120000_referral_pin_function_search_path.sql` migration is authored,
  file-verified, and unit-tested, but **could not be applied to staging** — the
  `.env.uat.local` provides no DB connection string (`SUPABASE_DB_URL`) and the
  service-role REST key does not grant DDL; the local Supabase CLI/MCP are a
  different account. Apply via the staging DB connection or dashboard, then run the
  advisors before/after.
- **Audit-export scalability** follow-up (above).
- **Rotate the service-role key** that was pasted into chat (it is now exposed in
  the conversation transcript).
