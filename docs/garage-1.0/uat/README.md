# GARAGE-1.0-FINAL physical UAT

Written for: an engineer or Moderator who needs to re-run the physical UAT (for instance on the canonical hosts after the Owner cutover).

`garage-final-stg01.spec.ts` drives **three real, signed-in actors** in three browser contexts — the Garage admin, the Garage mechanic and
a customer (the vehicle's owner) — through the whole workshop lifecycle, in the UI, against a deployed pair on the staging database. It
is kept here and **not** in `tests/agents/` on purpose: it reads credentials at import, and the repository's default Playwright run
(`npm run test:qa`) must never discover it.

## What it does (20 tests, one continuous run)

provenance → customer request → admin accepts **choosing a site** → customer requests a time, garage confirms with a planned mechanic →
estimate → bypass attempts → customer accepts → stock, assignment, start → mechanic work, parts, completion (sees no prices) → invoice
(refuses an unpriced line), partial and final payment, receipts → customer sees them → visit fulfilled → stock and operations →
**negative journey** (decline; four downstream doors refused, each for its own reason) → **mobile 390×844** → history convergence →
**security** → **OPS01–OPS03 regression** → communications observation → pairing (every API request went to the one backend host).

Every assertion that matches text uses an exact pattern where a loose one would pass vacuously (`Partly paid` also contains `paid`;
`80.00` also contains `0.00`). Refusals are asserted by **reason**, not just by status.

## Credentials: a bounded, self-restoring window

Nobody types or commits a password. The operator generates three passwords locally and commits only their scrypt **hashes**:

1. Put the hashes in `backend/scripts/garage-final-stg01-window-hashes.json` on cert branch `cert/garage-1.0-final-stg01-window-r1` and push.
   The workflow checks custody (exact product commit with green CI, OPS03 PR still Draft/unmerged), refuses any database URL that is not
   staging, snapshots existing sessions, provisions the synthetic customer + vehicle (idempotent), and grants the hashes to **three pinned
   synthetic identities** (`uat_ops01_owner_20261022a`, `uat_ops01_mech01_20261022a`, `uat_final_customer_20261024a`).
2. Run the spec locally against the pair under test (see below). The runner never held a plaintext credential.
3. Close the window by pushing the branch ref `cert/garage-1.0-final-stg01-window-r1-stop` (then delete it), or let the 90-minute limit
   do it. Cleanup **always** runs: it restores `password_hash` to NULL only where it equals the window hash, invalidates only sessions
   created in the window, then `verify-clean` proves it, and a read-only **DB witness** records everything the window changed.

Check it independently: `select id, password_hash is not null from users where id in (<the three ids>)` must be all `false`.

## Running it

```bash
export GARAGE_FINAL_SHA=<exact commit under test>
export GARAGE_FINAL_WEB=https://<web host>                     # Preview pair, or https://staging.carup.dev after the cutover
export GARAGE_FINAL_API=https://<backend host>/api             # or https://api-staging.carup.dev/api
export GARAGE_FINAL_CREDS=~/path/to/credentials.json           # {"admin":"…","mechanic":"…","customer":"…"}  (0600, never committed)
export GARAGE_FINAL_EVIDENCE_DIR=~/path/to/evidence-folder
npx playwright test -c docs/garage-1.0/uat/playwright.config.ts   # visible Chrome; GARAGE_FINAL_HEADLESS=1 for headless
node docs/garage-1.0/uat/reconcile.cjs <db-witness.json> <out.json>  # 19 business invariants from the witness rows
```

The spec asserts that the web's provenance names the exact commit and the backend host, that the backend's database is
`eoyenigwevnxwwhyhaer`, and that external sends are disabled, before it does anything.

## Gotchas learned the hard way

* The work order is created by the **first estimate**, not by accepting the case.
* After a part is created, the stock page opens its detail itself; clicking "Stock history" again **closes** it.
* The invoice form is pre-filled from the *actual* record; a service record with no cost gives an unpriced line, which the form (rightly) refuses.
* A Preview deployment has no communications worker, and the canonical worker dead-letters events it has no handler for.
* A Playwright config must live inside the repository to resolve `@playwright/test`.
