# Vehicle Passport / Trust Lifecycle 1.0 — Phase Receipts

Every runtime phase must leave an exact-head evidence receipt in this directory.

Required receipt pattern:

- source/base SHA;
- exact candidate head;
- open PR and lane reconciliation;
- upstream Seller status;
- changed-file ownership;
- schema/migrations;
- canonical authority contracts touched;
- tests run;
- staging/runtime evidence;
- privacy/security evidence;
- visual/mobile evidence where applicable;
- unresolved findings;
- PASS/BLOCKED;
- next authorized phase.

Recommended receipt names are defined in the canonical plan.

The planning-time baseline receipt is not a substitute for V0. V0 must be rerun from live repository truth when runtime implementation is actually authorized.
