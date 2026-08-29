# S8 — Service Link Foundation — Certification

- **Programme:** CarUp Service Network Foundation 1.0
- **Date:** 2026-08-29
- **Base:** `main` @ `ba208963` (pre-#194, owner override — see PRE_S0 §1)
- **Authority contract:** `S0_LIVE_RECONCILIATION_AND_AUTHORITY_FREEZE.md`

## 1. What S8 builds

Service Link as a **resource-link protocol**, not a QR subsystem — QR and deep links are
transports over one resolver, and NFC would reuse it (plan §6.8, §20, §21).

`20260901170000_service_network_s8_service_links.sql` creates two deliberately separate things:

- **`service_links`** — permanent addresses for `vehicle`, `service_case`, `practitioner`.
  Opaque 128-bit public token; `UNIQUE(resource_type, resource_id)` so a resource has exactly
  one stable address. **No private payload**, so a windscreen sticker is safe to photograph.
- **`service_capability_grants`** — temporary, revocable, purpose-scoped capabilities following
  the proven **SA1C** pattern: the raw secret is returned once and only its SHA-256 hash is
  persisted; redemption is a single conditional UPDATE, so it is atomic and replay-safe.
  `expires_at` is `NOT NULL` — **there is no standing access**.

`auth_action_tokens` is deliberately **not** reused: its purpose CHECK is closed to four auth
purposes, and widening it would destabilise SA1. The *pattern* is reused; the table is not.

## 2. The security claim: a scan grants nothing

Plan §20's principle is *Scan → Resolve → Authenticate → Authorize → Act → Record*, and
resolution is intentionally the **weakest** step — holding a printed sticker proves only that
someone held a printed sticker.

| Who scans | What they learn |
|---|---|
| Unauthenticated | That it is a link, and a sign-in path. Nothing else — no VIN, no owner, no case |
| A stranger, vehicle link | That it is a vehicle. **`vin: null`** — the VIN is disclosed only to the owner |
| The owner, vehicle link | Owner context and the VIN |
| A non-participant, case link | `not_a_participant` — **not even the case status** |
| A participant, case link | The case and its status |
| Anyone, practitioner link | Governed public projection only: affiliation where published, `credential_review_state: 'not_reviewed'` (Foundation ships no credential workflow). **Activity is not quality** — a test asserts no rating/score/quality field can appear |

A revoked and an unknown token are **indistinguishable** — the resolver is not an existence
oracle. The scanner device never becomes authority (§20.5): writes bind to the authenticated
user and verified tenant membership, and no device identity is fabricated.

Source attribution flows onward: a resolution reports `source_channel: 'qr'` (§20.4).

## 3. Capability rule (plan §21)

| Required property | How S8 provides it |
|---|---|
| Explicit resource authority | Only the vehicle **owner**, or the case **requester**, may grant. A garage cannot grant itself access — asserted by test |
| Minimum scope + purpose | Closed vocabularies: `service_case_participation`, `service_context_read`; resources limited to `vehicle`/`service_case` |
| Expiry | Mandatory (`NOT NULL`), 4h/24h by purpose |
| Revocation | Immediate, granter-only, effective before or after redemption |
| Recipient authentication | Redemption requires an authenticated actor |
| Audit | Granter, grantee tenant, redeemer and revoker are all recorded |
| No hidden access to insurance/finance/private documents | The DB CHECK **refuses** a grant over any other resource type — proven against real PostgreSQL |
| Hashed bearer secret | Only the hash is stored; a test proves the stored hash itself cannot be replayed as a token |

## 4. Verification

| Gate | Command | Result |
|---|---|---|
| S8 migration proof (real PostgreSQL) | `node database/test/service_network_s8_check.mjs` | **PASS** — RLS posture, one-link-per-resource and token uniqueness (23505), resource-type/purpose CHECKs refusing insurance and finance resources (23514), `expires_at` mandatory (23502), Down/re-Up |
| S8 link and capability contracts | `node --test backend/tests/service-network-s8-service-link.test.js` | **PASS** — 17/17 |
| Full backend suite | `node --test backend/tests/*.test.js` | **PASS** — 4471 tests, **4450 pass, 0 fail**, 21 skipped. S7 baseline 4453/0 → +18, **zero regressions** |

## 5. Defect found: comparison filters were vacuous in the shared mock

The expiry test failed by *passing* a token that should have been rejected. Cause: the
in-memory mock's `.gt()`, `.lt()`, `.gte()` and `.lte()` were **no-ops that returned the chain
untouched**, so every range-filtered query returned the whole table. Expiry enforcement — a
real security property — was therefore untestable, and any existing test relying on a range
filter was passing vacuously.

Fixed by implementing real comparison semantics in the mock, following SQL three-valued logic
(a NULL never satisfies a comparison; dates compare chronologically, numbers numerically).
The full suite then passed with **zero** regressions, which establishes that no pre-existing
test was depending on the broken behaviour.

This is the third defect of the same family found in this programme (after the missing `count`
support in S1 and the unregistered unique indexes in S5): the mock silently permitting what
PostgreSQL refuses.

## 6. Deliberately NOT in S8

QR image generation and any scanning UI (no `qrcode` package is added; S9 owns surfaces);
NFC; a generic sharing centre (plan §21 explicitly does not require one); and any capability
over insurance, finance or document resources — refused at the database.

## 7. `[#194-sensitive]` items for the rebase

- Public lookup contracts: `passportLookupPolicy.PUBLIC_LOOKUP_KINDS` is deliberately a list of
  one. If Service Link resolution is ever exposed as a passport-style public lookup, it must be
  added there openly rather than becoming a second unlisted anonymous oracle.
- `web/src/App.tsx` route additions for any scan surface remain a rebase hotspot.
