# One CarUp — RC2 residual scan

**Branch:** `integration/one-carup-source-rc2`. Its code head is `3b36b1b4`; these records follow it as
docs-only commits.

**Method:**
- RC1's eighteen searches were re-run over the whole tree. The scope was `backend`, `web/src`,
  `mobile`, `shared`, `database` and `docs`, excluding tests unless the item concerns them.
- Each hit was read, not counted.
- Then every residual OC-5 recorded, and everything the RC2 PR disposition found, was classified.

**Classes (the programme moderator's):**

| Class | Meaning |
|---|---|
| **FIXED** | Changed on this lineage, CI-proven, and mutation-tested where it is an authority boundary. |
| **INTENTIONALLY GOVERNED** | Kept on purpose, with the rule that governs it named. |
| **EXPLICIT OWNER BLOCKER** | Needs a named owner decision. No source change was safe or authorized. |
| **RUNTIME-CERTIFICATION BLOCKER** | Needs a governed staging pair, a live provider or a human. It cannot be closed in source. |

**Result:** no P0 is open. Every P1 RC1 named, and every P1 OC-5 found, is **FIXED**. What remains is
owner decisions, runtime certification, or recorded P2/P3 work, listed at the end with its owner.

## RC1's searches, re-run on RC2

| # | Looked for | Found on RC2 | Class |
|---|---|---|---|
| 1 | Direct vendor AI calls outside the gateway and the OCR boundary | None. `GeminiClient` is the vision reserve, selected only by an explicit `CARUP_OCR_PROVIDER=gemini`. Groq is Communications media only. | INTENTIONALLY GOVERNED (OC-4B) |
| 2 | Retired routes still reachable or called | `/api/ai/ocr` answers 410 `LEGACY_OCR_PATH_RETIRED`. `runOcrParsing` appears only in comments. | FIXED (RC1 `d06e9c2f`) |
| 3 | Vehicle-trust writers outside canonical Trust | `TrustEnforcementEngine` still writes `vehicles.trust_score` and its history. Nothing imports it; `canonicalTrustService` names it in comments only. | EXPLICIT OWNER BLOCKER — delete the dead engine in a Trust-lane change |
| 4 | Ledger writes outside the canonical writer | None. OC-5A routes PartSentry through `ledger_event_intents` into the one writer. | FIXED / clean |
| 5 | x-user-id fallback forced on | None | Clean |
| 6 | Ledger hash v2 enabled | None (an explanatory comment only) | Clean |
| 7 | Automatic Vercel Git deployments | `git.deploymentEnabled: false` in all three `vercel.json` files | Clean |
| 8 | A provider selected because its key exists | The evidence-analysis seam that ran a simulator whenever `GEMINI_API_KEY` existed is gone. A credential's presence selects nothing, and the state is honestly `not_configured`. | **FIXED** — OC-5B `f12bfff0` |
| 9 | Raw tenant membership used as authority | Every garage route requires a selected, verified, active garage (`requireActiveTenant`). A tenant role never satisfies a platform role list (F4). | **FIXED** — OC-5D `30c5f95b`, `7e244e5a`, `cdc81ae8` |
| 10 | Tenant-derived effective roles (finding B) | A membership lends only `mechanic` or `dealer` (an allow-list). `switch-role` and feature governance follow the same rule. | **FIXED** — OC-5A P1-B `66e6dee8`, OC-5D. The catalogue CHECK is `NOT VALID` until production role counts are read. |
| 11 | Notifications that cannot deliver (finding C) | All six policy templates are registered, and the gate is strict. It now also sees producer renders and schema-qualified registrations. | **FIXED** — OC-5G `e49b17ce`. `leadership_welcome_v1`: EXPLICIT OWNER BLOCKER (below) |
| 12 | Credentials committed | None (`oc4f-no-committed-credentials` green) | Clean |
| 13 | Simulators reachable outside tests | The simulator refuses outside the fixture runtime, behind the selector | **FIXED** — OC-5B |
| 14 | Partial writes before a refusable step (finding D) | Record, odometer and ledger intent commit in one transaction. A kept record is never reported as failed. | **FIXED** — OC-5A P1-D `6317d832` |
| 15 | Native static guards | `escrow.tsx` sends the ngrok header on 1 of 3 fetches. The header matters only behind a development ngrok tunnel; no production path depends on it. | INTENTIONALLY GOVERNED (development-only header) |
| 16 | Stale proof | The older local Playwright agent specs fail identically on `main` | INTENTIONALLY GOVERNED — superseded as proof by OC-4E and OC-5H's journeys |
| 17 | Tests that age out | One future-dated literal (`garageTeam.test.tsx`, `2026-10-12`). It is display-only: the page reads the server's `status` and compares no clock. | Clean |
| 18 | Gates this lineage never triggered | The RC2 Draft PR's checks, compared against #220's baseline (see the RC2 PR) | RUNTIME-CERTIFICATION BLOCKER for every staging-pair gate |

**RC1 findings A–D:**
- **A** — PartSentry for non-mechanic roles: **FIXED** in OC-5A P1-A `6317d832`.
- **B** — tenant-derived roles: **FIXED** in OC-5A P1-B `66e6dee8`.
- **C** — undeliverable templates: **FIXED** in OC-5G.
- **D** — PartSentry partial write: **FIXED** in OC-5A P1-D `6317d832`.

## Residuals OC-5 found — and how each was classified

| Finding | Severity | Class |
|---|---|---|
| The live notification path ignored `policyChannelsOnly`: in-app-only notices went out on email for anyone who preferred it, and default preferences queued email and push as fallbacks | P1 | **FIXED** — OC-5G G1 `572a8927` (5/5 mutants) |
| A refused rollup write reported success (`ok: true`, run completed, nothing written) | P1 | **FIXED** — OC-5F `f5de0967` (3/3) |
| rollup@2 (#213) credited a reservation to whoever owned the vehicle at recompute time — after a transfer, the buyer | P1 | **FIXED** — OC-5F `135319f0` (10/10) |
| The Diaspora AI Command Center loaded its commands without end (330 loads in 1.5 s), found via #137 | P1 | **FIXED** — OC-5J `12f640d8`, plus a guard over every holder of the API aggregate (3/3 guard mutants) |
| Ownership-transfer refusals answered 500 (found via #208, hit live in owner UAT) | P2 | **FIXED** — OC-5J `3b36b1b4` (5/5) |
| A full-suite flake: issue-158 wrote mutant copies into the source tree | test infrastructure | **FIXED** — OC-5J `4dd9d302` (root cause), plus the `__mutant__` skip in two scanners (OC-5G) |
| #209's invitation acceptance was two calls, any tenant admin could invite (F1), and a decision race was possible | P1 | **FIXED** — OC-5E `4068fe1f`, `b28cf5b2` |
| The service-history response named other people; the native Garage crashed on `item.cost` | P1 | **FIXED** — OC-5D `6783ae3f` |
| The applicant session leaked the reviewer's internal note; idempotency handed one user another's evidence | P1 | **FIXED** — OC-5C `fcb1a908`, `1d0d7003` |
| `leadership_welcome_v1` (Email Experience R1) is rendered on every verified address and registered nowhere | P2 | EXPLICIT OWNER BLOCKER — the lane authors R1's governed copy (listed in the gate) |
| Listing moderation stores the moderator's free-text reason in notification payloads (never rendered; pinned) | P2 | EXPLICIT OWNER BLOCKER — keep, or stop storing it |
| `readListingOwners` degrades silently on a read failure | P2 | EXPLICIT OWNER BLOCKER — moderator sign-off; it reverses a documented choice |
| Spec 48's Communications phase: as #213 wrote it, the reply is a real WhatsApp send | P1 if run | EXPLICIT OWNER BLOCKER — `fixme` until decision D, and pinned so the inquiry can never carry a phone |
| Identity documents cannot be PDFs (#208 `b822a3bb`) | P2 | EXPLICIT OWNER BLOCKER |
| The home page's phone layout (#208 `b822a3bb`); overflow at 393 px unmeasured | P2 | RUNTIME-CERTIFICATION BLOCKER — measure in the RC2 mobile UAT |
| `trust_audit_events` keeps a target only for vehicle, evidence and PartSentry; OC-5E put its subjects in the values | P2 | EXPLICIT OWNER BLOCKER — a platform audit-schema decision (Trust/Audit lane) |
| The shared staging config calls `testMatch` additions "additive"; the aggregate gates run it whole | P3 | INTENTIONALLY GOVERNED — spec 48 has its own config; the claim is recorded |
| The media lifecycle gate rotates `uat.buyer` and `uat.reviewer` to a random password, while the bootstrap sets them from the secret | P2 for certification | RUNTIME-CERTIFICATION BLOCKER — serialise, or move that gate to the bootstrap pattern, before concurrent staging runs |
| Five June-2026 migration timestamp prefixes are shared | — | INTENTIONALLY GOVERNED — applied history, allow-listed exactly by `migration-integrity`; any new collision fails |
| Mobile vitest collects two standalone `.tsx` scripts | P3 | EXPLICIT OWNER BLOCKER (mobile lane hygiene; no behaviour) |
| "Active portal: Mechanic" label for a garage member | P3 | EXPLICIT OWNER BLOCKER (UX; presentation only, recorded in OC-5D) |
| Candidate migrations (OC-3D, OC-4A, OC-5C X5A and X4) | — | EXPLICIT OWNER BLOCKER — promotion decisions |
| Every OC-5 migration is unapplied | — | RUNTIME-CERTIFICATION BLOCKER — the staging apply steps of the RC2 runbook |
| Staging identity is unresolved, and spec 48 / GMO-8 / P7 / X7 / mobile UAT have not run | — | RUNTIME-CERTIFICATION BLOCKER |
| The production catalogue audit | — | RUNTIME-CERTIFICATION BLOCKER — deferred; no authorized catalogue access during OC-5 |

## Recorded P2/P3 work (not P0/P1), with owners

- **#137 (Diaspora lane):**
  - P2: the import checklist can never show "Uploaded";
  - P2: Diaspora notifications are written without a channel, so they are invisible (R7B);
  - P2: the portal switcher offers refused roles (decision needed);
  - P3: Passport `returnTo`, import detail, and the free-text organisation field.
  - The exact commits to re-author are in the RC2 PR disposition.
- **#208 (O2 lane), P3:**
  - the dealer onboarding phone layout remainder;
  - strict server-side identity upload validation;
  - the U1 journey test;
  - `auth_method` never written;
  - `hidden` rather than `sr-only` file inputs on two onboarding pages;
  - #208's documentation.
- **#200 (Seller lane), optional:** a login recovery hint, the existing-account panel, the evidence
  basis on the Marketplace card, and `?tab=evidence`.
