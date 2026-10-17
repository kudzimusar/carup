# One CarUp — pending certification coverage register

This file records **missing evidence coverage only**. It is not a certification receipt and must
never be interpreted as SOURCE-, DATABASE-, LIVE-PROVIDER-, DEPLOYED-, or OWNER-UAT-CERTIFIED
evidence. Formal receipts remain exclusively in
`docs/one-carup/certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

## Why this register exists

The certification manifest is receipt-shaped: adding a fake "pending receipt" would fabricate
evidence. OC-5R therefore records uncovered capability families here until a real receipt can be
created at the correct evidence level.

| Capability family | Current ceiling during OC-5R | What is still required |
|---|---|---|
| General AI / Gemma gateway | source implementation present | exact-head source recertification; live provider smoke; deployed proof |
| OCR / Qwen Document Intelligence | source implementation present | exact-head source recertification; bounded live OCR; deployed/owner proof |
| Canonical Trust | source implementation present; synthetic score fallbacks being removed | staging DB audit; canonical score/default cleanup decision; deployed proof |
| Referral | source implementation present | explicit journey/capability receipt and deployed proof |
| Google Drive | source implementation present; OAuth callback remediated in OC-5R | managed-vault credential proof; live OAuth/Drive smoke; deployed proof |
| Billing / subscriptions | no approved live money provider | owner provider decision; provider contract/credentials; live/deployed proof |
| SafeTrade payment | no approved regulated live payment/escrow provider | owner provider decision; live provider implementation; deployed proof |
| Finance / lender | provider activation not certified | owner/provider approval; live provider proof; deployed proof |
| Insurance | live underwriting/quote provider not certified | owner/provider approval; live provider proof; deployed proof |
| Communications marketing Email / Brevo | source adapter present | live-provider smoke, webhook proof, deployed proof |
| Push / Expo | source-integrated at accepted Expo lineage | EXPO access token, staging deployment, physical-device delivery, owner UAT |
| Admin / moderation | source surfaces exist | explicit capability/journey receipts and deployed owner-role proof |
| Registry / government source verification | only sandbox/demonstration adapters exist today | real authenticated source or explicit unavailable; no sandbox may certify |
| Marketplace publication / media | source authority present | staging data-debt inventory and deployed public-surface proof |

## Governing rules

- A mock, simulator, fixture, PGlite harness, localhost run, or static UI proves no live provider,
  deployment, production readiness, or owner UAT.
- Deployed staging/production must show an explicit unavailable/not-configured state when a real
  provider or canonical datum is absent.
- Historical migration bytes are not rewritten to clean synthetic data. After staging is restored,
  contamination is measured read-only first and any cleanup is additive and owner-authorized.
- This register closes only when every row is backed by real receipts in the formal manifest or is
  explicitly retired by owner/moderator authority.
