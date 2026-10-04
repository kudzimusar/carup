# One CarUp — RC1 residual scan

**Branch:** `integration/one-carup-source-rc1`. This document records what the last scan looked for, how it looked, and what it found. Each finding is fixed in RC1, accepted by an earlier phase's decision, or recorded for an owner.

**Method:** every item was searched over the whole tree. The search scope was `backend`, `web/src`, `mobile`, `shared`, `database` and `docs`, excluding tests unless the item concerns them. Each hit was then read, not counted. Patterns are given so the scan can be re-run.

**Legend:**
- **Fixed** — changed in RC1.
- **Accepted** — kept deliberately, by the phase named.
- **Recorded** — handed to an owner. No source change was safe or authorized.

| # | Looked for | How | Found | Disposition |
|---|---|---|---|---|
| 1 | Direct vendor AI calls outside the gateway and the OCR boundary | `askGemini`, `generativelanguage.googleapis`, `api.groq.com`, `api.openai.com`, `openai`, `@google/generative-ai`, `moonshot`, `openrouter` in runtime code | `GeminiClient` — the vision path only. It is the non-default OCR reserve, chosen only by an explicit `CARUP_OCR_PROVIDER=gemini`. `communicationGroqProvider` — Communications media only (MULTIMODAL DEFERRED). | **Accepted** (OC-4B) |
| 2 | Retired routes still reachable or still called | `/api/ai/ocr`, `runOcrParsing`, `approveDocumentVerification`, the retired `/api/verification` router | The server has only the OC-4C 410 tombstone. The web client still exported a dead `runOcrParsing` that POSTed to `/ai/ocr`. | **Fixed** — `d06e9c2f`, pinned by `web/src/lib/retiredRoutes.test.ts` |
| 3 | Vehicle-trust writers outside canonical Trust | Writes of `trust_score`; inserts into `trust_score_history`; `calculateVehicleTrustScore` | `TrustEnforcementEngine` writes `vehicles.trust_score` and `trust_score_history`, but nothing imports it (OC-4A pinned it as runtime-unreachable). `diaspora_trade_profiles.trust_score` and `stakeholder_profiles.trust_score` are different entities owned by different domains. | **Recorded** — delete the dead engine in a Trust-lane change |
| 4 | Ledger writes outside the one canonical writer | Writes to the ledger tables | All are in `blockchainService` | Clean |
| 5 | x-user-id identity fallback forced on in configuration | `CARUP_ALLOW_X_USER_ID_FALLBACK=true` in non-test files | None. The fallback stays test/dev/local only and is refused on production deployments. | Clean |
| 6 | Ledger hash v2 enabled | `CARUP_LEDGER_HASH_VERSION=2` in non-test files | None (only the explanatory comment) | Clean |
| 7 | Automatic Vercel Git deployments | `git.deploymentEnabled` in each `vercel.json` | `false` in the root, web and backend | Clean (#218) |
| 8 | A provider selected merely because its key exists | Readers of `GEMINI_API_KEY` / `GROQ_API_KEY` | OCR is chosen by `CARUP_OCR_PROVIDER` (default Cloudflare / Qwen), and Communications refuses `gemini`. Remaining: `analysisProvider.isLiveConfigured()` still picks the labelled evidence-analysis **simulator** seam when `GEMINI_API_KEY` is set. It calls no Gemini. | **Accepted / Recorded** (OC-4B): select the seam by the chosen evidence-vision provider's own configuration |
| 9 | Raw tenant membership used as authority | `tenant_id ===`, `.includes(…tenant_id)`, aliased spellings | Governed at every seller, commerce and private-evidence surface, including two found only on this lineage (OC-4D, `981ab07b`). Three keep their own tenant scope by design: Service Network assignment, PartSentry service writes, and lender/insurer object authority (all pinned). | **Fixed** / **Accepted**. For PartSentry, see finding A. |
| 10 | Tenant-derived effective roles | `resolveEffectiveRole` | Any tenant role except `admin` can be claimed through `x-stakeholder-role`. No product path writes `tenant_users` today, so this is latent. #209's role catalogue (`admin`, `mechanic`, `dealer`, `member`) ships with the membership writers. | **Recorded** (finding B) |
| 11 | Notifications that cannot deliver | Policy `templateKey`s with no governed-registry migration | Six keys: `seller_authority_v1`, `verification_decision_v1`, `evidence_review_v1`, `listing_moderation_v1`, `vehicle_trust_update_v1`, `safetrade_transaction_v1` (ten SafeTrade stages). They were already tracked as `KNOWN_UNREGISTERED` in `communication-event-coverage.test.js` and are owned by their lanes. RC1's one new policy key, `dealer_compliance_decision_v1`, ships its registration. | **Recorded** (finding C) |
| 12 | Credentials committed to the tree | Postgres URLs with inline passwords; Google, OpenAI, Groq, GitHub and Slack keys; private keys; signed JWTs | None. The three Postgres URLs on production and staging hosts carry a `[ROTATED-…]` marker, not a password. The scan first misread the marker, so the guard pins both real-credential shapes it nearly exempted. | **Fixed** — tripwire `1489dd1d` |
| 13 | Simulators and fixtures reachable outside tests | `ALLOW_OCR_MOCK`, mock / simulator selectors | One guard (`backend/config/testFixtureGuard.js`) refuses under `VERCEL_ENV` production/preview and `CARUP_ENV` production/staging. | Clean (OC-3B-R) |
| 14 | Partial writes before a refusable step | Read-through of PartSentry, found by an OC-4E journey | `addRepairLog` persists the log and the canonical odometer before a ledger write that can refuse. | **Recorded** (finding D) |
| 15 | Native static guards | `mobile/tests/tab-stability-guard.test.ts` | The escrow screen sends the ngrok header on 1 of 2 fetches. Pre-existing: `escrow.tsx` is unchanged since `main`, and the file is not in CI's native set. | **Recorded** |
| 16 | Stale proof | The older local Playwright agent specs | They fail identically on `main` and RC1 (11 failed / 3 passed / 2 skipped). | **Recorded**. OC-4E's spec replaces them as proof. |

## Findings for the owner

**A. PartSentry service writes.** For non-mechanic roles (owner, dealer) the route still accepts raw tenant membership. A member of a dealership could log repairs, and move the canonical odometer, on the dealership's vehicles.

- #208 deliberately classified PartSentry as its own service authority. Mechanics already need a work order or their organisation's vehicle.
- **Decision needed:** should a dealership membership log repairs, or should the non-mechanic branch use the governed Dealer decision?

**B. Tenant-derived effective roles.** `resolveEffectiveRole` accepts any tenant role except `admin` as the effective role, including names such as `government` or `reviewer`.

- It is latent: nothing writes `tenant_users`.
- Before any membership writer ships:
  1. apply #209's role catalogue;
  2. count the roles on staging and production;
  3. update the premise of `oc4a-provenance-object-authority`, which relies on a tenant-derived `reviewer` being reachable today.

**C. Six notification templates fail closed** wherever the governed registry is applied (staging has it). As a result, these never reach anyone there:

- identity decisions;
- seller-authority decisions;
- evidence reviews;
- listing moderation;
- trust presentation changes;
- every SafeTrade transaction stage.

`vehicle_trust_update_v1` and `safetrade_transaction_v1` also have **no in-code copy**. Before a registry exists they fall back to the generic acknowledgement text. Each owning lane must author and register its copy under governance.

**D. PartSentry partial write.** When the ledger write refuses (for example, custody rollout not FINALIZED):

- the log and the odometer are already saved;
- the caller is told the request failed (400);
- the 5-minute idempotency block then rejects the retry.

This predates OC-4. Make the ledger write part of the same unit of work, or record the ledger outcome on the log row instead of failing the request.

**E. Production observation** (read-only public `/api/health`, 2026-10-04 09:22Z):

| Item | Value |
|---|---|
| Commit | `78303ed6` |
| Deployment | `dpl_HDk3…` |
| Supabase | healthy |
| `outboxBacklog` | 312 |

Production Communications is inactive, so domain events accumulate. Staging `/api/health` returns 500 (`FUNCTION_INVOCATION_FAILED`).
