# CARUP-PAY-05-LR01 — Zimbabwe Collections & Mobile Money

**Status:** Level 1 implemented and certified on isolated infrastructure. The provider is a local Paynow **protocol
simulator**. Real Paynow is not authorized and cannot be reached (`BLOCKED_OWNER_PROVIDER_EVIDENCE`, see §8).
Nothing here is a statement of commercial readiness.
**Issue:** kudzimusar/carup#252 · **Parent:** PAY-04 accepted head `18440746` (+ Checkpoint A reconciliation `b3ca4d21`)
**Certification:** [CARUP_PAY_05_FINAL_CERTIFICATION.md](CARUP_PAY_05_FINAL_CERTIFICATION.md) · **Evidence:** [evidence/pay05/](evidence/pay05/)

PAY-05 lets a customer pay a garage invoice through **the garage's own Paynow merchant account**. Paynow's hosted page
and the Express methods EcoCash, OneMoney, InnBucks and O'mari are supported, in USD and ZWG. The money belongs to the
garage from the first cent. CarUp holds none of it, never routes it through CarUp Japan's Stripe account, and counts it
only when Paynow itself confirms it.

---

## 1. What PAY-05 delivers

| Area | Delivered |
|---|---|
| **A. Safety** | No pull-request event can reach a shared-staging secret. Staging integration is dispatch-only, environment-gated and authorization-recorded. A repository-wide policy check enforces this ([docs/ci/WORKFLOW_SECRET_ISOLATION.md](../ci/WORKFLOW_SECRET_ISOLATION.md)). PAY-04 Draft PR #253. |
| **B. Provider qualification** | A Paynow capability matrix built from Paynow's own documentation, with each operation marked supported, unsupported or unverified (§3). BillPay is kept apart. |
| **C. Merchant ownership** | Garage connects **its own** Paynow merchant: legal profile, settlement account, one integration per currency. Keys are sealed. An independent CarUp operator verifies, and a server-side credential probe proves each key. Merchants can be rejected, suspended or disconnected, all audited. All 66 PAY-02 products have a funds-ownership disposition (§4). |
| **D. Adapter + money** | A Paynow protocol adapter implementing the PAY-04 provider-adapter contract. It runs on the accepted PAY-04 collection, reservation, allocation, receipt, discrepancy and F5 model, with Paynow-specific states (§5). |
| **E. Experience** | Customer checkout and continuation, garage Paynow connection, garage payments view, and an operator panel, all inside the existing app (§6). |
| **F. Certification** | Real-PostgreSQL certification in both lineage orders. Four independent reviews were remediated. Mutation testing, a physical HTTP matrix plus the PAY-04 26-case regression, and headed-Chromium UAT at 1440/768/390 (see the certification). |
| **G. Real provider** | Not executed. It needs Owner + Paynow authorization (§8). |

## 2. Checkpoint A — the pull-request / shared-staging defect (closed)

`diaspora-phases-3-7-validation.yml` ran a staging-integration job, writing to shared staging, on any same-repository
pull request touching the backend. Every workflow was audited, and the defect class was removed from all of them:

- No `pull_request_target` or `workflow_run`.
- No pull-request-context event reaches any secret but `GITHUB_TOKEN`.
- Shared-data secrets are reachable only from `workflow_dispatch` or `schedule`, behind `environment: staging` or
  `production`.
- The governed staging integration (`diaspora-staging-integration.yml`) requires an authorization comment URL and the
  expected SHA.

`scripts/ci/workflow-secret-isolation.mjs` enforces this on every push and pull request, and its dry run proves the
reach of any PR. It is verified without touching staging; see the Checkpoint A section of the certification.

## 3. Checkpoint B — Paynow capability matrix

**How it was built:** from Paynow's own developer documentation, read-only on 2026-11-02, with the official SDKs as a
secondary source. Copies are preserved with SHA-256s: [evidence/pay05/paynow-sources.sha256](evidence/pay05/paynow-sources.sha256).
No Paynow endpoint was contacted.

**Sources:**
- `D/x` = `https://developers.paynow.co.zw/docs/paynow/x/`
- `F/n` = a forums.paynow.co.zw thread ("staff" = a Paynow staff answer)
- `W/x` = `https://www.paynow.co.zw/Home/x`

**Verdicts:** **S** = supported (documented); **U** = unsupported, or absent from every source; **?** = unverified.

| # | Capability | Verdict | Evidence | PAY-05 behaviour |
|---|---|---|---|---|
| 1 | Hosted initiation `/interface/initiatetransaction` → `Ok`, `browserurl`, `pollurl`, hash | S | D/initiate_transaction | Implemented. The reply's hash is verified before any URL in it is used. |
| 2 | Express `/interface/remotetransaction` (`authemail`, `phone`, `method`) | S | D/express_checkout_transactions | Implemented for EcoCash, OneMoney, InnBucks and O'mari. |
| 3 | EcoCash / OneMoney USSD push | S | D/initiate_mobile_transaction | Implemented. Test numbers are in the simulator. |
| 4 | InnBucks authorization code + expiry, USD only | S (docs) | D/express_checkout; Paynow blog "InnBucks is a USD only payment option" | Implemented. USD only, enforced in database, service and UI. The phone is sent (Paynow's plugins do). |
| 5 | O'mari OTP (`remoteotpurl`; 5 bad OTPs cancel) | S (docs only) | D/express_checkout | Implemented. The OTP URL is allowlisted. The OTP host is unverified (§8). |
| 6 | Zimswitch / Visa-Mastercard Express | Token-only, permission-gated | D/express_checkout | **Not offered.** Cards are handled on Paynow's hosted page only. |
| 7 | Methods enabled per integration | S | D/express_checkout | Each integration lists its methods; unlisted ones are refused before anything is reserved. |
| 8 | Currency: one integration ID per currency; **no currency field** in the API | S | F/4285 (staff); WooCommerce plugin | One integration per currency. Paynow cannot confirm a currency, so the operator attests each integration's currency configuration at verification (independent review P3). |
| 9 | USD and ZWG | S, depends on method | Paynow site; BillPay uses ZWG | The ISO codes are `USD` and `ZWG`. "ZIG" is refused everywhere; "ZiG" appears only in prose. |
| 10 | Integration ID + key; test mode on the same endpoints | S | D/integration_generation, D/test_mode | Keys are sealed with AES-256-GCM and bound to their tenant, merchant, currency, integration ID and mode. |
| 11 | Hash: `UPPER(HEX(SHA512(values in order, URL-decoded, hash excluded ‖ key)))`; values trimmed | S | D/generating_hash (vector `2A033FC3…`), D/validating_hash (`750DD0B0…`) | Both published vectors reproduce. `2A033FC3…` matches the page's message as printed, which has a leading space, only with values trimmed, as Paynow's own example code does. CarUp signs and sends trimmed values and compares in constant time. |
| 12 | Status update to `resulturl`, up to 10 resends; validate the hash; poll to confirm | S | D/status_update | A verified update is only a **trigger**; the money effect comes from a fresh poll of the stored poll URL. Retry interval, source IPs and ordering are unverified. |
| 13 | Poll = empty POST to `pollurl` | S | D/polling_status | Implemented with a read ticket for ordering (§5.4). Rate limits are unverified. |
| 14 | Trace `/interface/trace` by merchant trace; a "trace error does not necessarily mean … not found" | S | D/polling_status | Used only to recover a lost reply; never to send twice. Two authenticated NotFound replies at least 60 s apart resolve a request as absent. |
| 15 | Statuses Paid, Awaiting Delivery, Delivered, Created, Sent, Cancelled, Disputed, Refunded | S | D/status_update | Each kept distinct. **Only Paid counts.** Escrow (Awaiting Delivery, Delivered) is held, not counted. "Failed" (test mode), "Created but not paid" and "Awaiting Redirect" (SDK words) are pending, never money. Unknown words go to review. |
| 16 | Expiry of unpaid transactions | **?** | nothing documented | CarUp's own collection time only starts a **hold**. Paynow may still take the money: the room stays held until Paynow reports an outcome or an operator releases it after a fresh unpaid read. |
| 17 | Merchant cancel API | **U** | absent everywhere; D/status_update ("may not be resumed") | `cancelCheckout` returns `unsupported_by_provider` and makes no call. A customer "stop" is recorded; the UI says Paynow cannot cancel. |
| 18 | Merchant refund API | **U** | F/497 (staff): "refund option is not available for merchants" | CarUp refuses (`PAY05_PROVIDER_REFUND_UNSUPPORTED`) and guides the garage to its Paynow dashboard. A reported `Refunded` is recorded and reviewed. |
| 19 | Dashboard refund (Refunded pushed/pollable); partial refunds | S (staff forum); partial **?** | F/3820 (staff) | `Refunded` stops counting and opens `provider_refund_unquantified` for the operator, since Paynow names no amount. |
| 20 | Disputed (funds in suspense); chargeback signal | Disputed S; chargeback **?** | D/status_update; W/Terms 13(d), 17 | Disputed money is held, not counted, and reviewed. Only Paynow's own later Paid ends it. |
| 21 | Settlement to the merchant's Zimbabwean bank account; escrow (BuySafe) | S | W/MerchantTutorial | Settlement goes to the **garage's** account, which the garage attests (last 4 digits only) and the operator reviews. |
| 22 | Aggregator / collecting on behalf of other merchants | **U, prohibited** | F/240 (staff); W/Terms | CarUp never collects on anyone's behalf. Every request uses the garage's own integration. |
| 23 | Split payments / disbursements | ? / U | F/9387 (staff, 2026-10-05) | Not used. |
| 24 | FX conversion by Paynow | U | F/4285 (staff) | None. CarUp never converts currencies. |
| 25 | Returned-URL hosts | ? | doc examples show `:7106` and `staging.paynow.co.zw` | Real mode allows only `https://www.paynow.co.zw` (fail-closed). Confirming hosts with Paynow is an activation item. |

**BillPay is a different product.** BillPay (`https://developers.paynow.co.zw/docs/billpay/intro/`) is a
vendor/biller platform at `billpay.paynow.co.zw`, with HTTP Basic auth and JSON. Its `POST /api/payment/reverse`
reverses a *vendor's* biller payment into the vendor's prefunded wallet ("A very limited set of billers accept
reversals/refunds. Most do not."). It does not reverse a customer payment collected through `/interface/*`, and it
proves no merchant refund capability. PAY-05 uses no BillPay endpoint.

**Providers beyond Paynow:** none were qualified. The directive says to start with Paynow, and a second provider would
be a separate qualification.

## 4. Checkpoint C — legal merchant ownership

### 4.1 Three categories, enforced in data

| Category | Rule | PAY-05 |
|---|---|---|
| CarUp first-party | Only with an approved CarUp ZW merchant and an approved tariff | **Blocked**: neither exists. The collection tables bind to garage invoices, so no first-party Paynow path exists to misuse. |
| Garage third-party | The garage's customer money goes only to the garage's verified merchant | **Implemented (Level 1)**. Ledger rows carry `pay02_funds_owner = garage_business_tenant` and `pay02_legal_beneficiary = tenant:<garage>`; the database invariant is checked in UAT. |
| Other third parties | Sellers, insurers, lenders, government and freight keep their own funds and contracts | **Blocked** for their later packages (PAY-06/07/08), each with a named owner. |

**Product coverage:** all 66 PAY-02 products ([`pay05ProductCoverage.js`](../../backend/services/payment/pay05ProductCoverage.js), tested).

| Disposition | Count |
|---|---|
| Garage invoice payment, implemented at Level 1 | 1 |
| Diagnostic fee, collected as an invoice line | 1 |
| Garage money blocked by garage policy | 4 |
| First-party, no ZW merchant | 12 |
| Custody (buyer deposits; needs a licensed custodian) | 4 |
| Other parties' later packages | 20 |
| Corporate treasury, not a checkout | 10 |
| Not Zimbabwe | 14 |

The five products PAY-02 assigned to PAY-05 are all honestly blocked, each for its legal reason. No garage product is
eligible for CarUp Japan's Stripe.

### 4.2 Merchant onboarding and custody

1. **Connect (garage administrator only).** The garage administrator enters:
   - the legal entity name and registration number;
   - the settlement bank, account holder and the account's **last four digits** only;
   - an attestation, whose wording the server generates;
   - one integration per currency: integration ID, key and enabled methods.

   The **server's** mode (`CARUP_PAY05_PAYNOW_MODE`; Level 1: `simulator` only) is used, never the browser's. The key
   is normalised (trimmed; a GUID lower-cased) and sealed with AES-256-GCM before any write. It is never returned,
   logged or shown again; only a 16-hex fingerprint is kept. One live owner per integration ID: garage B can never
   register garage A's integration.
2. **Verify (an independent CarUp operator).** The operator must not be the registrant or any garage member; this is
   checked before any key is opened and again in the database. The operator confirms:
   - the legal identity;
   - the settlement account;
   - each integration's **currency configuration**.

   The **server** then probes every key with an authenticated Paynow trace of a random merchant trace. Only the right
   key verifies Paynow's signed reply, and the probe's fingerprint is derived from the key actually opened. The
   database refuses verification without complete evidence.
3. **Reject / suspend / disconnect.** Rejection records a reason, which the garage sees, and lets the garage reconnect.
   Suspension (operator or garage) closes every integration. All three are append-only audited
   (`pay05_merchant_audit_events`, mirrored to `trust_audit_events`).
4. **Availability.** The operator's switch turns Paynow off for every garage, for incidents. It also stops a begun
   collection from being sent.

## 5. Checkpoint D — the adapter and the money model

### 5.1 Reuse of PAY-04

PAY-05 adds no second money system. A Paynow collection **is** a PAY-04 collection, with its:
- reservation inside `pay04_invoice_money`;
- provider receipts;
- discrepancies;
- notifications;
- canonical `payment_transactions` row (PAY-02 classification);
- lock order (invoice advisory → payment reference → rows).

Nine accepted PAY-04 functions gain bounded Paynow hunks. Three more refuse Paynow rows: the simulator-path suspend
and refund writers, and the resolve hunk. `backend/tests/pay05-pay04-function-drift.test.js` derives all twelve from
the accepted text and pins every other statement aimed at PAY-04 tables.

The Paynow adapter implements the PAY-04 provider-adapter contract (`pay04ProviderAdapters.js`):
- `createCheckout`
- `getPaymentTruth`
- `cancelCheckout` (→ `unsupported_by_provider`)
- `refund` (refuses)
- status-update verification

A Paynow adapter is **per integration**: one key per garage and currency. `pay04AdapterFor('paynow_zimbabwe')`
therefore keeps refusing, and the PAY-05 service builds the adapter from the collection's own verified integration.
Any PAY-04 path that did not dispatch to PAY-05 fails closed.

### 5.2 One request per collection, recorded before it is sent

1. `pay05_record_paynow_sending` records the request and its merchant trace **before** anything is sent. A retry
   replays it; there is never a second Paynow request.
2. The reply is verified with the integration key, then `pay05_attach_paynow_collection` binds the poll URL once.
3. A lost or unauthenticated reply is recovered by an authenticated **trace**, never by resending.
4. An unsigned `Error` closes the request at once and frees its room (`refused`). So does a refusal CarUp makes
   locally before sending (`not_sent`).
5. Should Paynow's own **signed** update later show a closed request existed, it binds **late**
   (`attached_after_close`). Its money becomes an operator review, never lost and never counted.

### 5.3 Paynow statuses → money

| Paynow says | CarUp | Room |
|---|---|---|
| Created / Sent (and SDK pending words) | pending, nothing counted | held |
| Awaiting Delivery / Delivered (escrow) | pending, nothing counted | held |
| **Paid** (amount = the request) | **counted**, provider receipt issued, customer notified | consumed |
| Paid, wrong amount | `amount_mismatch` review, nothing counted | held until resolved |
| Paid after CarUp closed the payment | `provider_paid_after_close` review, never counted | — |
| Cancelled / Failed | closed, nothing counted | freed |
| Disputed | held, not counted, `provider_disputed` review; ended only by Paynow's own later Paid | held |
| Refunded | not counted; `provider_refund_unquantified` for the operator (Paynow names no amount) | freed |
| An unknown word, or a step back from money | `provider_status_unrecognized` review | held |

### 5.4 Ordering: why a stale read can never move money (independent review D1)

Paynow is read outside any database lock (a poll, a trace, an O'mari reply, or the poll a status update triggers), so
the order reads arrive in is not the order Paynow answered them. Every read takes a database **read ticket**
(`pay05_begin_paynow_read`) **before** it is sent:
- A read older than the latest read CarUp evaluated is recorded as `superseded` and never applied.
- A pre-payment status arriving after money (a lagging replica) is a `stale_regression`, also recorded and ignored.
- Every observation records its outcome: `applied`, `review`, `superseded`, `stale_regression`, `after_settlement` or
  `after_close`.
- "Paynow reports Paid", which the operator needs to end a dispute, means a read CarUp **applied**.

A status update counts as a resend only if both hold:
- it is byte-identical to the last one CarUp recorded;
- CarUp still holds the status that update reported.

The sequence Paid → Disputed (learned by poll) → Paid is therefore three events.

### 5.5 Holds, release, late money, settlement

- A collection's time (`expires_at`, 30 minutes in production) only starts a hold.
- **Release:** an operator who is not the payer and not a garage member can release the room after expiry, given
  either:
  - a fresh read: the **latest** authenticated read of any kind, at most 15 minutes old, showing Created or Sent; or
  - for a request Paynow never confirmed, a fresh trace attempt.
- **Late money:** money that arrives after a release counts only into free room; otherwise it is unallocated money for
  an operator. It is never counted twice.
- **Settlement:** the operator can settle a wrong-amount Paid or an unrecognised status **outside CarUp**. That
  releases the room, and later reports of the same money are recorded only.

### 5.6 What fails closed

| Capability Paynow lacks | PAY-05 |
|---|---|
| Cancel | Stop recorded; room held; UI says so |
| Expiry | Hold + operator release after a fresh unpaid read |
| Refund API | Refused with dashboard guidance; Refunded recorded on report |
| Currency field | Operator currency attestation; one integration per currency |
| F5 partial-refund evidence | `PAY05_F5_NOT_APPLICABLE`: a Paynow payment never enters an F5 hold |
| Real Paynow at Level 1 | Mode `simulator` only. `paynow_real_enabled` is refused by a CHECK constraint, and the adapter requires `CARUP_PAY05_REAL_PROVIDER_AUTHORIZED` |

## 6. Checkpoint E — the experience (existing CarUp app)

- **Customer** (`InvoicePayment`, `PaynowCheckout`, `PaynowPendingPanel`, `PaymentReturnNotice`):
  - choose an enabled method;
  - pay on Paynow's page, approve on the phone, use the InnBucks code, or enter the O'mari code;
  - see "not counted yet" until CarUp's own read confirms;
  - continue an in-progress payment later;
  - stop waiting, with "Paynow cannot cancel" stated.

  A browser return or an unverified callback is never presented as payment. Tone and label follow CarUp's state.
- **Garage** (`PaynowConnection`, `ProviderPaymentsPanel`):
  - connect, with field-level validation;
  - see verification status and any rejection reason;
  - disconnect;
  - see Paynow payments in third-person wording;
  - get refund guidance (in the Paynow dashboard).
- **Operator** (`PaynowOperatorPanel`, `GaragePaymentsOperator`):
  - verify (three reviews plus a note; the server probes keys) or reject;
  - suspend;
  - use the availability switch;
  - release held and unconfirmed requests (shown with their expiry);
  - read provider errors and the merchant audit history;
  - resolve reviews with Paynow-specific options.

Accessibility is designed for WCAG 2.2 AA at 1440/768/390 px: labelled controls, errors tied to fields, live regions,
focus moved to results, 44 px targets. It is verified with axe in headed Chromium (see the certification).

## 7. Security model

- **Paynow's result URL** (`POST /api/pay05/paynow/webhook/:collectionId`):
  - It is the only CSRF-exempt PAY-05 path.
  - Its raw body is verified with **that collection's** integration key and bound to its reference and poll URL.
  - Its money effect is a fresh poll.
  - Every refusal gets one identical answer (`400 PAY05_STATUS_UPDATE_REFUSED`; `503 PAY05_STATUS_UPDATE_RETRY` for
    transient failures). The reason is recorded for the operator in `pay05_provider_errors`, throttled to one row per
    collection and kind per minute.
- **Rate limits:** every `/api/pay05/*` route sits behind the shared 60-second sensitive limiter, mounted before the
  router.
- **Credentials:**
  - The KEK comes from `CARUP_PAY05_CREDENTIAL_KEK` (32 random bytes; uniform-byte keys are refused).
  - The AAD binds tenant, merchant, currency, integration ID and mode.
  - Keys never appear in responses, logs, errors, provider-error rows or audit; evidence scans assert this.
- **Least privilege:** every PAY-05 table has RLS and is revoked from `anon`/`authenticated`; `service_role` only
  reads. All writes go through SECURITY DEFINER writers with a pinned `search_path`.
- **Server-authoritative values:**
  - Amount, currency, merchant and integration come from the database. The client chooses only a method from the
    enabled set, and a phone that is validated and masked.
  - The payer e-mail is taken server-side.
- **SSRF:** Paynow-returned URLs are followed only to Paynow: in real mode `https://www.paynow.co.zw` exactly; in
  simulator mode, the configured loopback origin. Redirects are not followed, there are 45 s / 15 s timeouts, and
  replies are capped at a streamed 64 KiB.

## 8. Activation (Level 2) — blocked, and what unblocks it

**`BLOCKED_OWNER_PROVIDER_EVIDENCE`:** no Owner + Paynow authorization exists, so no real Paynow call was made.
Activation needs:

1. Owner authorization and a garage with a real Paynow merchant contract (its own legal entity and settlement account).
2. The garage's real integration ID + key per currency, connected through the product.
3. A reviewed activation migration that drops `pay05_real_paynow_requires_activation_migration`.
4. `CARUP_PAY05_REAL_PROVIDER_AUTHORIZED=true` with a production KEK.
5. A bounded rehearsal (Checkpoint G): one small payment per method/currency, provider readback reconciled to the
   ledger.

**Questions only Paynow can answer.** Each is fail-closed today.

| # | Question | Fail-closed now |
|---|---|---|
| 1 | Expiry and late-payment behaviour | Room held + operator release |
| 2 | Cancel API | None; stop recorded |
| 3 | Refund API, partial refunds, procedure | Dashboard guidance; review on Refunded |
| 4 | Duplicate reference / merchant trace per method / trace for hosted payments | One request per collection; trace only for recovery |
| 5 | Callback retry interval, source IPs, ordering, fee-inclusive amounts | Read tickets + poll confirmation |
| 6 | Polling rate limits; IP blocking of cloud egress (forum: shared IPs blocked) | Refresh at most once a minute per request; a static-IP egress may be needed |
| 7 | Returned-URL hosts (`:7106`, `staging.`) | Only `https://www.paynow.co.zw` allowed |
| 8 | ZWG per integration, per-method currency, limits | Operator currency attestation |
| 9 | Current fees and settlement fees | Not modelled |
| 10 | Marketplace model: CarUp initiating with the garage's own credentials | Garage-owned integration only; CarUp is never the merchant |
| 11 | Escrow / BuySafe delivery confirmation via API | Escrow is never money |
| 12 | Tokenization eligibility (card/Zimswitch Express) | Not offered |
| 13 | Undefined status words | Review |
| 14 | Hash edge cases (empty fields, trimming confirmation) | Values trimmed and sent trimmed |
| 15 | InnBucks / O'mari fixtures, sandbox host | Simulator only |
| 16 | Chargeback notification | None assumed |
| 17 | Receipt documents | CarUp provider receipt from the confirmed payment |
| 18 | **Test mode requires `authemail` = the merchant's login e-mail** (D/test_mode) | Real modes unreachable. A per-integration test e-mail is needed for the Checkpoint G rehearsal. |
| 19 | **The NotFound trace reply's hash formula** (the docs' example does not verify under the assumed formula) | An unverifiable reply is never "authenticated": verification refuses. Confirm with Paynow before Level 2. |

## 9. Operations (operator runbook, short)

- **Verify** a pending merchant: check the legal documents, the settlement account and each integration's currency in
  the garage's Paynow account, add a note, then **Verify**. The server then probes every key. On a refused probe,
  reject with the reason; the garage sees it.
- **Held requests:** a stopped or expired Paynow request keeps its room. After its expiry, **Release** (or **Close
  unconfirmed request**). The server reads Paynow first and refuses if it is not fresh-unpaid.
- **Reviews** (garage payments operator page):

  | Review | Resolution |
  |---|---|
  | `provider_disputed` | Ends on Paynow's own Paid |
  | `amount_mismatch` | `provider_corrected`, or **settled outside CarUp** (frees the room) |
  | `provider_paid_after_close` | Settled outside CarUp, or acknowledged |
  | `provider_refund_unquantified` | Acknowledged once the Paynow records are checked |

- **Incidents:** switch Paynow off with a reason. Checkouts stop, including requests already begun but not sent.
- **Kill switch:** `CARUP_PAY05_ENABLED=false` stops every Paynow route and every Paynow call from PAY-04 views.

## 10. Configuration

| Variable | Meaning |
|---|---|
| `CARUP_PAY05_ENABLED` | `true` enables PAY-05; it also needs `CARUP_PAY04_ENABLED=true` and a non-production runtime at Level 1 |
| `CARUP_PAY05_PAYNOW_MODE` | The server's mode for new integrations. Level 1: `simulator` only |
| `CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN` | Loopback origin of the protocol simulator. Never a WHATWG fetch "bad port" (5060/5061) |
| `CARUP_PAY05_RESULT_ORIGIN` | Public origin of CarUp's Paynow result URL |
| `CARUP_PAY05_CREDENTIAL_KEK` / `_KEK_VERSION` | Base64 of 32 random bytes / its version |
| `CARUP_PAY05_REAL_PROVIDER_AUTHORIZED` | Never set at Level 1 |
| `CARUP_PAY04_UAT_COLLECTION_TTL_SECONDS` | Disposable UAT only (5–3600); ignored in production |

## 11. Where things are

| Layer | Files |
|---|---|
| Database | `database/migrations/20261103100000_carup_pay05_zimbabwe_paynow_collections.sql` |
| Protocol / custody / adapter | `backend/services/payment/pay05PaynowProtocol.js`, `pay05CredentialVault.js`, `pay05PaynowAdapter.js`, `pay05Contract.js` |
| Services | `pay05MerchantService.js`, `pay05PaynowCollectionService.js`, PAY-05 dispatch in `pay04GaragePaymentService.js`, `pay05ProductCoverage.js` |
| Routes | `backend/routes/pay05ZimbabweCollectionRoutes.js` (limiters in `server.js`, one CSRF exemption) |
| Simulator | `backend/services/payment/pay05PaynowSimulator.js`, `scripts/uat/pay05-paynow-simulator-server.mjs` |
| Web | `web/src/lib/pay05Paynow.ts`, `components/owner/serviceJourney/{PaynowCheckout,PaynowPendingPanel}.tsx`, `components/garage/PaynowConnection.tsx`, `components/admin/PaynowOperatorPanel.tsx` |
| Tests | `backend/tests/pay05-*.test.js`, `backend/tests/sql/pay05-paynow-collections-postgres-smoke.sql`, `web/src/**/*Paynow*.test.tsx` |
| Certification | `scripts/ci/pay05-postgres-certification.sh`, `.github/workflows/pay05-zimbabwe-collections-ci.yml` |
| UAT | `scripts/uat/pay05-*`, `web/e2e/pay05-zimbabwe-paynow.spec.ts` |
