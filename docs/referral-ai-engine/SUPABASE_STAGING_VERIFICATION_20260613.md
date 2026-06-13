# Supabase Staging Verification — Referral Engine

Date: 2026-06-13

Branch: `feature/referral-engine-phase7-trust-review`

Project verified: `carup-staging`

Project ref: `eoyenigwevnxwwhyhaer`

Production/main-looking project intentionally not touched: `CarUp` / `vhmnajoeicasaigiophh`

## Summary

Supabase staging verification was completed for the Referral Engine foundation schema.

Result: **passed with one non-blocking architectural note**.

The staging database already contained the referral migration output, so no migration was applied during this verification pass.

## Checks performed

### 1. Referral tables and RLS

Query checked all `public.referral_%` tables and their RLS status.

Result: 9 referral tables exist and all have RLS enabled.

Tables verified:

- `referral_admin_audit_events`
- `referral_campaigns`
- `referral_codes`
- `referral_coupon_redemptions`
- `referral_coupons`
- `referral_events`
- `referral_share_assets`
- `referral_wallet_transactions`
- `referral_wallets`

### 2. Constraints

Checked PostgreSQL constraints for all `referral_%` tables.

Confirmed key constraints exist:

- `referral_campaigns(tenant_id, slug)` unique constraint.
- `referral_codes.code` unique constraint.
- `referral_coupons.code` unique constraint.
- `referral_coupon_redemptions(coupon_id, redeemer_user_id)` unique constraint.
- `referral_coupon_redemptions.idempotency_key` unique constraint.
- `referral_wallets.user_id` unique constraint.
- Wallet transaction status check supports:
  - `created`
  - `pending`
  - `eligible`
  - `approved`
  - `payable`
  - `paid_or_applied`
  - `held`
  - `rejected`
- Signup-only guardrail constraint exists:
  - `referral_signup_only_not_matured`

### 3. Indexes

Checked indexes for all `referral_%` tables.

Confirmed expected lookup indexes exist for:

- campaign status/type/scope lookup;
- code lookup;
- campaign-code relationship;
- coupon lookup;
- coupon campaign relationship;
- event campaign timeline;
- event code timeline;
- event coupon lookup;
- event subject lookup;
- event wallet transaction lookup;
- share asset code/campaign lookup;
- wallet user lookup;
- wallet transaction wallet timeline;
- wallet transaction campaign/code/source-event lookup.

### 4. Triggers

Checked referral table triggers.

Confirmed `updated_at` triggers exist for:

- `referral_campaigns`
- `referral_codes`
- `referral_coupons`
- `referral_wallet_transactions`
- `referral_wallets`

### 5. RLS policy posture

Checked policy count per referral table.

Result: no explicit RLS policies were found.

This is **not a blocker** for the current backend architecture because RLS is enabled and therefore anon/authenticated direct table access is deny-by-default. Backend access is expected to be mediated through server-side service-role routes.

However, if a future frontend/mobile surface attempts direct Supabase client access to `referral_%` tables using anon/authenticated keys, explicit RLS policies must be designed first.

### 6. Rollback-scoped write/read smoke test

Ran a transaction-scoped insert/read/rollback smoke test against `referral_campaigns`.

Result: passed.

The test inserted and read one `DRAFT` referral campaign inside a transaction, then rolled back.

Follow-up check confirmed zero leftover staging-verification campaign rows.

### 7. DB-level signup-only guardrail smoke test

Ran a rollback-scoped guardrail check against `referral_wallets` and `referral_wallet_transactions`.

Result: passed.

The test attempted to insert a signup-sourced wallet transaction with status `eligible`. PostgreSQL rejected it through the DB-level `referral_signup_only_not_matured` check constraint.

The transaction was rolled back.

## Tooling limitations encountered

Some broad introspection queries were blocked by the tool safety layer:

- full policy-expression query;
- combined leftover row-count query;
- wallet leftover row-count query;
- final generic schema count query.

These blocks did not prevent the critical staging verification, because narrower equivalent checks were completed for the required areas.

## Final staging status

Supabase staging schema verification is complete.

Status: **passed**.

Remaining verification before merge:

1. CI should run the full referral `node --test` suite on the pushed PR branch.
2. Optional application-level staging API smoke can be run against the deployed backend if staging deployment is available.
3. Sequential PR merge should still follow:

```text
#62 -> #63 -> #64 -> #67 -> #68 -> #69 -> #71
```
