# I14 — Referral & Marketing Intelligence

**Programme:** CarUp Intelligence 1.0 · **Lane:** PR #185 · **Phase:** I14
**Status:** implementation and tests complete · **includes a P0 security closure (G4)**

---

## 1. G4 — a live attribution-forgery channel, found and closed

**This is the headline of the phase.** I14's stated deliverable includes *fraud-safe
attribution*, so the first thing checked was whether attribution could be forged.
It could.

The earlier G1 closure fixed `POST /api/referrals/events`. The **same forgery was
still open on four other referral routes, none of which has any authentication
gate**:

```
POST /api/referrals/validate
GET  /api/referrals/codes/:code
POST /api/referrals/local-marketplace/intent
POST /api/referrals/local-marketplace/leads
```

All four built their actor with `buildActorContext`, which falls back to the
`x-user-id`, `x-stakeholder-role`, `x-tenant-id` and `x-actor-type` request
headers. That function's own doc comment already said it *"is a forgery channel on
any public route"* — the routes simply had not been moved off it.

**The consequence.** An unauthenticated caller could write
`referral.code_validated` events attributed to any user, with any actor type
(including `admin`), into any tenant they named. `referral.code_validated` is the
single largest referral event type on staging and validations are the base of every
referral performance figure — so the entire attribution ledger these routes feed
was forgeable by anybody.

**Proof before fix.** `backend/tests/security-closure-g4-referral-attribution.test.js`
was written first and failed 4 of 6: the tenant was not derived from the code row,
and the routes did use the header builder.

**The fix:**
- the four routes now use `buildVerifiedActorContext(req)` behind `optionalAuth()`,
  so an anonymous caller is recorded as an anonymous user and a signed-in one from
  the verified session — never from a header;
- `validateReferralCode` now derives `tenant_id` from the **referral code row**,
  the authoritative source, on both the scan and the validation event;
- `createLead` derives its tenant from the validated code where one was presented,
  and never from the request body.

Even a genuinely verified session does not move a code into its own tenant: the
tenant is the code's. All 6 tests pass, and the full 210-test referral suite is
unchanged and green.

---

## 2. What the live data actually says

| Source | Rows | What it means |
|---|---|---|
| `referral_events` | 1163 | but only ~235 are `referral.*` |
| `referral_codes` | 64 | all ACTIVE |
| `referral_campaigns` | 58 | 57 ACTIVE, 1 DRAFT |
| `referral_wallet_transactions` | 62 | 53 `pending`, 9 `held`, **0 paid** |
| `referral_coupon_redemptions` | 8 | — |
| `dealer_promotions` | **0** | no promotion has ever run |
| `referral_admin_audit_events` | **0** | — |
| `marketplace_inquiries` with a referral code | 22 / 59 | 37% attribution coverage |

Three findings decide the phase.

**`referral_events` is a shared event log, not a referral log.** The table also
carries `trust.*` (disputes, risk checks, review cases, wallet holds),
`agent.tool_executed`, `ai_marketing.*`, `marketplace_*`, `import_campaign.*`,
`local_marketplace.*` and `channel.*` events. Counting it whole would inflate
referral activity roughly **fivefold**. The projection counts an explicit
referral-domain event set and reports how many events it excluded.

**There is no cost side anywhere.** No campaign, code or promotion table has a
budget, spend or cost column. ROI is a return divided by an investment, and CarUp
records no investment — so campaign ROI, channel ROI and promotion ROI are not
"not yet computed", they are **structurally underivable**. They are refused, and a
test asserts no payload field is even *named* roi/cost/spend/budget/profit.

**No referral reward has ever been paid.** All 62 wallet transactions are `pending`
or `held`. Accrued value and paid value are reported as separate blocks, the paid
block renders "Nothing has been paid", and the payload states that accrued figures
are *value promised, not value delivered*.

### The limitation that is declared rather than guessed

`actor_type` cannot separate organic from operator activity. The public
local-marketplace intent route records **every** caller as `agent` by construction,
which is why staging shows 477 `agent` events. An "organic referrals" figure would
therefore be wrong, so it is listed as not measurable with that exact reason rather
than estimated.

Source attribution is likewise thin: `source` is null on ~92% of events, while
`channel` is recorded on effectively all of them. The channel breakdown is served;
the source breakdown carries its coverage numerator and denominator so a sliver is
never read as the whole.

---

## 3. Two fake-negatives fixed on the owner wallet

Both concern an owner's own money.

- **Approved balance.** `(w?.approved_balance ?? 0) + (w?.payable_balance ?? 0)`
  coerced missing buckets to zero, showing an owner "nothing approved" for a
  figure the server never reported. Now only recorded buckets are summed; if
  neither is recorded the value stays unavailable.
- **Dispute state.** A failed dispute fetch collapsed to `[]`, and that list
  decorates each transaction with its dispute badge — so a genuinely **disputed**
  transaction rendered as undisputed to its owner. The wallet now says dispute
  status could not be loaded and that this is not confirmation none is open.

The rest of the referral console surfaces were checked and found clean; they were
built under the Referral V1 governance and carry no fabricated values.

---

## 4. Files

**New:** `backend/services/intelligence/referralIntelligenceService.js`,
`backend/tests/intelligence-referral.test.js`,
`backend/tests/security-closure-g4-referral-attribution.test.js`,
`web/src/components/intelligence/ReferralIntelligence.tsx`,
`web/src/components/intelligence/ReferralIntelligence.test.tsx`

**Modified:** `backend/routes/referralRoutes.js`,
`backend/services/referral/referralEngineService.js`,
`backend/services/referral/referralLocalMarketplaceService.js`,
`backend/routes/intelligenceProjectionRoutes.js`
(`GET /api/admin/referrals/intelligence`, `['admin']` — not `government`),
`web/src/hooks/useCarUpApi.ts`,
`web/src/pages/dashboard/owner/ReferralWallet.tsx`,
`web/src/pages/dashboard/admin/ReferralCampaigns.tsx`

`ReferralIntelligence` is **mounted** on the admin referral console.

**Migrations: none.**

---

## 5. Verification

| Gate | Result |
|---|---|
| Backend suite (ci.yml env) | **4671 tests, 0 fail**, 21 skipped |
| Web suite | **1246 tests, 115 files, 0 fail** |
| G4 security tests | 6 pass (4 failed before the fix) |
| Referral suites (210 tests) | unchanged, green |
| I14 backend tests | 16 pass |
| I14 web tests | 9 pass |
| Web typecheck / build | clean |

---

## 6. Carried forward

**To I19:** no reward payout exists to certify, and no live external partner
exists. Joins I9, I10, I11, I12 and I13.

**Still open from the I13 sweep** (their own phases): `GovernmentDashboard` and
`ComplianceReports` → I15; `AdminDashboard` → I16; the `TrustSafety` / `About`
marketing claims, including a "regulated trust account" statement that contradicts
the non-custodial notice.

**Unchanged pre-merge disposition:** the P2 `private_key_pem` issue in
`public_keys` is not addressed in this lane.

**Production boundary respected:** source and staging only. The G4 fix is a source
change on this branch; no production deployment was made.

**Next:** I15 — Government / Regulatory Intelligence.
