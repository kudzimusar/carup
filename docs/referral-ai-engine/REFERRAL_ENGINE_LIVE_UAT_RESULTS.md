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
| 7 — Fraud hold → human override | ✅ 6/0 | hold + override worked; audit-trail read passes after `f6b3097` fix |
| 8 — Dispute → resolution → audit checksum | ✅ 5/0 | dispute create/resolve + audit-export: count + checksum + event_id returned cleanly |
| 9 — WhatsApp/Telegram inbound attribution | ✅ 2/0 | inbound parsed, referral code extracted, attribution recorded |
| 10 — AI triage + safe handoff | ✅ 2/0 | triage returns intent + safe response + suggested tools; audited |

**Totals (final run, re-run 2026-06-22): 67 pass / 0 fail / 0 skip.** All 10 journeys
fully green. The 2 audit endpoint failures from the earlier run are resolved by the
`f6b3097` fix (bounded-summary audit-export, no recursive bloat).

## Defects found by the live UAT — fixed and unit-tested

| Sev | Defect | Fix | Live re-verify |
|-----|--------|-----|----------------|
| High | Import capacity preflight ignored `allow_waitlist` (over-capacity leads rejected instead of waitlisted) — in the **benchmark** service the routes use | `87e0c74` (preflight + lead record + test) | Journey 5 → 8/0 |
| Medium | Marketing asset rejection did not require a reason (plan mandates it) | `87e0c74` (validation + test) | Journey 6 → 13/0 |

The live run also exposed several **UAT-runner** bugs (wrongly skipping CSRF on
validate/coupon/channel/agent; container capacity setup; blank-owner and SEO-status
expectations) — fixed in `066e8dd`. The backend behavior in those cases was correct
(CSRF enforced, capacity enforced, blank-owner defaults to actor by design).

## Audit-export fix (f6b3097) — live proof

**Root cause (found 2026-06-22):** each `AUDIT_EXPORT_CREATED` event stored the
*entire* event list (including prior exports) in its metadata, so exports grew
exponentially and inserting the giant row hit the 60s Postgres statement timeout.

**Fix (`f6b3097`):** the recorded export event now stores only a bounded summary
(count, checksum, filters, limit) — never the event list; per-event records carry a
metadata *checksum* rather than raw metadata; the page size is validated and capped
(1..1000, default 500).

**Live proof (2026-06-22, 5× repeated exports):**
```
Export 1: success=True  count=200  distinct checksum  distinct event_id
Export 2: success=True  count=200  distinct checksum  distinct event_id
Export 3: success=True  count=200  distinct checksum  distinct event_id
Export 4: success=True  count=200  distinct checksum  distinct event_id
Export 5: success=True  count=200  distinct checksum  distinct event_id
```
Count stays bounded (≤ limit=200, not growing), no statement timeout, each export
mints exactly one audit event. Recursive bloat is eliminated.

## What this proves

- **Correct-owner wallet attribution is proven LIVE** — the single most important
  release gate.
- Auth/tenant boundaries, capacity + waitlist, marketing workflow (incl.
  rejection-reason), fraud hold/override, dispute lifecycle, channel inbound
  attribution, and AI triage all pass live against this branch's code.
- Two real backend defects were caught by the live run and fixed with regression
  tests; both re-verified live.

## Status (2026-06-23)

- **search_path migration (`20260621120000_referral_pin_function_search_path.sql`)**: applied to staging. ✅
- **Audit-export scalability**: fixed in `f6b3097`, live-proven by 5× repeated exports.  ✅
- **Browser Playwright UAT** (`web/e2e/referral-staging.spec.ts`): **4 / 4, 0 skipped**. ✅
- **P1 UAT guard defect** (Codex review thread): fixed in `edd6fe5`, 19 regression tests, thread resolved. ✅
- **Mobile owner UAT**: post-web-release check (Expo device required). Not falsely represented as passed.
- **Rotate the staging service-role key** (exposed in a prior chat session): owner-side action required.
