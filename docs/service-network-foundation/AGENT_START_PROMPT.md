# CarUp Service Network Foundation 1.0 — Agent Start Prompt

Implement **CarUp Service Network Foundation 1.0** exactly from the canonical plan:

`docs/service-network-foundation/CARUP_SERVICE_NETWORK_FOUNDATION_1_0_CANONICAL_PLAN.md`

Rules:

- Do not begin source implementation until PR #194 (or its approved successor) is merged and you have reconciled the new exact `main` SHA.
- Use one branch: `feat/service-network-foundation-1-0`.
- Deliver the complete Foundation in one PR, executing S0 → S10 sequentially on that same branch.
- Read the canonical plan, existing phase receipts and current diff before every handoff.
- Preserve existing CarUp authorities for Core/Auth/Tenant, Truth/Trust, Vehicle Passport, Evidence, PartSentry, Marketplace, Communications/Email/WhatsApp/push/internal messaging and Intelligence. Extend them; do not duplicate them.
- Commit the required receipt after each phase and continue automatically to the next phase when gates pass.
- Do not stop to ask for permission between phases. Stop only for a manual condition explicitly allowed by §30 of the canonical plan.
- Do not activate protected production migrations/providers or invent public data.
- Finalize only when S0–S10, exact-head CI/staging evidence and the final certification receipt are complete with no unresolved P0/P1.
