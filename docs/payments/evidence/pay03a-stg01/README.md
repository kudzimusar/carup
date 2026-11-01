# CARUP-PAY-03A-STG01-FINAL — sanitized evidence

Report: [`../../CARUP_PAY_03A_STG01_FINAL_CERTIFICATION.md`](../../CARUP_PAY_03A_STG01_FINAL_CERTIFICATION.md).
Runtime candidate `cc4f66384baf285eb8ebd3fca5bf7199a0b8f609`; isolated local Supabase (127.0.0.1:54321/54322).

**QA data only.** Every vehicle is `QA-PAY03A-*`, labelled `QA_INTEGRATION_FIXTURE`. Accounts use the reserved `.invalid` TLD, and images are generated solid-colour fixtures. Stripe objects are TEST-mode (`cs_test_`, `pi_`, `re_`) on the CarUp Japan sandbox account.

**Withheld here, kept in the Owner's protected local store:**
* the UAT account credentials;
* backend and launcher logs;
* the PAY-01C database dump;
* full-page admin captures;
* Stripe keys and webhook secrets (never seen by the specialist).

| File | What it shows |
|---|---|
| `http-matrix-stage5.json` | Stage 5.7 negative-security matrix: 34/34 at the candidate, with observed status, code and refusing layer for each case |
| `stage6-checkout.json` | The single authorized Checkout (recovered by idempotent replay of the same session) |
| `stage6-paid-checks.json` | 22/22 paid-phase checks: ledger, hash reproducibility, privacy, isolation, non-vacuous RLS, share expiry, idempotent reconcile |
| `stage6-refunded-checks.json` | 15/15 refund-phase checks: one refund, revocation everywhere, idempotent replay, attributed audit |
| `qa-provisioning-summary.json` | QA accounts and evidence created through product routes (no passwords) |
| `db-readiness.txt` | Tables, RLS, grants, RPC signatures, `SECURITY DEFINER` and `search_path` settings, triggers, policies, buckets |
| `local-migration-ledger.txt` | `carup_uat.migration_ledger`: 40 entries, SHA-256 of each file and of its applied Up section |
| `pay01c-preservation-summary.txt` | Every original PAY-01C row unchanged after the schema build and after Stage 6 |
| `owner-decision-1..3.json` | The Owner's recorded decisions: gate, policy, payment and refund; re-confirmation; re-authorization for `cc4f6638` |
| `screens/` | Stage 5 (three viewports) and Stage 6 (pre-purchase → Stripe Sandbox ¥100 → paid → report → share → refunded) |
