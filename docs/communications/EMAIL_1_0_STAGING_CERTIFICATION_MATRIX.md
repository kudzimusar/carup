# CarUp Email Experience 1.0 — certification matrix

Candidate SHA **`0925cb2c`** on `feat/email-experience-design-system-1-0-implementation`.
Migration `20260826120000_email_1_0_hardening.sql`, SHA-256
`c66cfb712aef05810e9d1faa9e495611d649e0bc4e956b6a4c1b069dfea1ef03`.

## Source certification

| Gate | Result | Evidence |
|---|---|---|
| G0 recipient authority | **PASS** | `email-experience-recipient-resolution.test.js` — fails closed; transient retries, durable dead-letters |
| G1 escaping | **PASS** | `email-experience-escaping-authority.test.js` — literal in text, escaped once in HTML, 3 mutants killed |
| G3 consent + unsubscribe | **PASS** | `email-experience-unsubscribe-ownership.test.js` — exactly-one contract, fail-closed consent, 10 mutants |
| G2 renderer + classification | **PASS** | `email-experience-classification.test.js`, `-renderer.test.js` — 5 families, missing/invalid/conflict all refuse, 10 mutants |
| G4 Resend provenance | **PASS** | `email-experience-resend-provenance.test.js` — wire-derived, Level A through the real router, 12 mutants |
| G5 reply token (source) | **PASS** | `email-experience-reply-token.test.js`, `-reply-roundtrip.test.js` — v2 derived, stable reuse, 12 mutants |
| G12 public routes + assets | **PASS** | `email-experience-public-prerequisites.test.js` + real HTTP against the built output, 9 mutants |
| G6 R2 source equivalence | **PASS** | `email-experience-auth-equivalence.test.js` — 16 invariants checked on every send, 7 mutants |
| R1 Leadership Welcome | **PASS** | `email-reference-r1-leadership-welcome.test.js` — real verify-email producer, idempotent |
| R3 Marketplace Conversation | **PASS** | `email-reference-r3-marketplace-conversation.test.js` — real `routeMessage`, G5 credential end to end |
| R4 SafeTrade | **PASS** | `email-reference-r4-safetrade-transaction.test.js` — 10 real events subscribed, unmapped state refused |
| R5 Trust Update | **PASS** | `email-reference-r5-vehicle-trust-update.test.js` — real producer, four states, owner-only |
| R6 CarUp Weekly | **PASS** | `email-reference-r6-carup-weekly.test.js` — consent gate, one unsubscribe, human-curated |
| B4 owner visual approval | **PASS** | owner-granted. R1 92 · R2 93 · R3 91 · R4 91 · R5 91 · R6 91; accessibility 9/10; 0 automatic fails |

## Hardening

| Item | Result | Evidence |
|---|---|---|
| G5-D1 version default | **CLOSED (source)** | migration sets `DEFAULT 2`; **no backfill** — a v1 row is a credential still in an inbox |
| G5-D2 permanent inbound reasons | **CLOSED** | the three `bound_participant_*` strings taken from source and classified permanent; `lookup_failed` deliberately left retryable; 2 mutants killed |
| G5-D3 duplicate hash index | **CLOSED — redundancy PROVEN** | live staging shows `email_reply_tokens_token_hash_key` UNIQUE btree `(token_hash)` and `idx_email_reply_tokens_hash` non-unique btree on the identical column, no predicate, default opclass. Dropped; the unique constraint untouched. |
| R5-D1 Trust event durability | **CLOSED** | durable announcement fingerprint on `vehicles`; comparison is "what did we tell them" not "what did we last write"; failure test fails under swallow-and-forget |

## Staging migration preflight — **PASS** (live, read-only)

Run against canonical staging Supabase.

| Check | Live value | Effect |
|---|---|---|
| `email_reply_tokens` by version | version 1: **2 rows, 0 live** | nothing at risk — no live v1 credential exists |
| live v2 credentials | **0** | — |
| `version` column default | **`1`** | drift confirmed; `ALTER … SET DEFAULT 2` is required and is a no-op for existing rows |
| `email_reply_tokens_token_hash_key` | `CREATE UNIQUE INDEX … btree (token_hash)` | **retained** |
| `idx_email_reply_tokens_hash` | `CREATE INDEX … btree (token_hash)` | identical coverage, non-unique → **safe to drop** |
| `vehicles.trust_presentation_announced_fingerprint` | **ABSENT** | `ADD COLUMN` required |

No destructive rewrite. No production database touched. **Not applied** — see the blockers below.

## Physical certification — **ALL PENDING**

| Gate | Result | Reason |
|---|---|---|
| G6 physical reset | **PENDING** | blocked |
| G5 physical round trip | **PENDING** | blocked |
| R1 / R3 / R4 / R5 / R6 physical | **PENDING** | blocked |

## Blockers — three, all requiring an owner action

**1. Staging reply-token secret is absent.** `CARUP_EMAIL_REPLY_TOKEN_SECRET` is not in the
`carup-backend-staging` environment (75 vars present; `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`BREVO_API_KEY` and `COMMUNICATION_WORKER_SECRET` are). Setting it through the platform mechanism was
attempted and **refused by the environment's own safety classifier**. This is the stop §15 names.
Without it, G5 conversation Reply-To minting fails closed and no conversational Email sends.

**2. Exact-head CI and independent review cannot be obtained.** `ci.yml` triggers only on
`pull_request`/`push` to `main`. This branch has never triggered it (`gh run list` returns empty), and
Codex review requires a PR comment naming the SHA. Opening a PR is an owner decision this directive
does not grant — §25 forbids merging, and every earlier gate had the owner authorise PR creation
separately.

**3. The certification inbox is not reachable from here.** Every physical gate requires reading
`eleven.eleven.testing@gmail.com`, and §17 additionally requires a **human reply** from it. Sends can
be driven; receipt, rendering and the reply cannot be verified without that inbox.

## Deferred / remaining

`PRODUCTION_COMMUNICATIONS=INACTIVE`. No production migration, no production secret, no DNS,
no Cloudflare, no provider allocation change, no merge.
