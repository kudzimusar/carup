# ADR-001 — Subscription billing provider for CarUp Diaspora Trade OS

- **Status:** Accepted (engineering decision). **Not activated.** `APPROVED_LIVE_PROVIDERS` is empty and
  stays empty until the owner-only external actions in §9 are complete.
- **Date:** 2026-07-28
- **Context:** Issue #127, Deliverable D — subscription billing in provider **test mode**.
- **Decision owners:** engineering proposes; merchant onboarding, currency approval and money-movement
  authorization are owner-only and are explicitly *not* decided by this ADR.

---

## 1. Why this decision is not obvious

Most SaaS billing decisions collapse to "use Stripe". This one does not, because the two halves of the
customer base sit on opposite sides of a payments boundary that no single provider spans well:

| | Diaspora buyer | Zimbabwe-resident seller / dealer |
|---|---|---|
| Where they are | UK, South Africa, USA, Australia, EU | Zimbabwe |
| What they pay with | Visa/Mastercard, Apple/Google Pay, local bank rails | EcoCash, InnBucks, OneMoney, Zimswitch, local USD nostro cards |
| Currency they think in | GBP / ZAR / USD / EUR / AUD | USD (and ZiG for statutory purposes) |
| Card penetration | High | Low; mobile money is the default rail |
| Chargeback rights | Full card scheme chargebacks | **None** — mobile money is push-payment and final |
| Who can bill them | Any global PSP | Only a locally-licensed aggregator |

A provider chosen only for the diaspora side cannot collect from Zimbabwe sellers at all. A provider
chosen only for the Zimbabwe side gives up subscription lifecycle management, dunning, proration, tax
handling and dispute tooling for the customers most likely to pay by card. The decision is therefore
about **which provider is the subscription system of record**, and **which rail collects the money**,
and accepting that those may not be the same company.

---

## 2. Decision drivers

1. **Merchant eligibility.** Can CarUp actually hold a merchant account with this provider, given the
   operating entity's country of incorporation? This is the hardest constraint and it eliminates
   otherwise-best options.
2. **Settlement currency.** Which currencies can be charged, and which can be *settled out*? Zimbabwe
   exchange-control rules mean "can charge USD" and "can receive USD offshore" are different questions.
3. **Rail coverage.** Cards for the diaspora; mobile money for Zimbabwe. Both are mandatory; neither is
   optional.
4. **Native subscription support.** Recurring schedules, trials, proration on plan change, dunning and
   retry on failed renewal, cancel-at-period-end. Rebuilding these is months of work and a source of
   revenue bugs.
5. **Webhook quality.** Signed against the raw body, stable event ids, delivery retries, replay from a
   dashboard, and an authoritative "fetch current state" endpoint to reconcile against. Ordering is
   *never* guaranteed by anyone — our ledger must handle that regardless (see §7).
6. **Refunds and disputes.** Card chargebacks need evidence submission and a dispute lifecycle. Mobile
   money has no chargeback at all, which changes refunds from an API call into an operational process.
7. **Fees and taxes.** Headline MDR is only part of the cost. Zimbabwe's 2% IMTT applies to electronic
   transactions and is a real line item; VAT/withholding and invoice-format obligations differ per
   jurisdiction and are the main argument for a merchant-of-record.
8. **Invoicing and tax compliance.** ZIMRA fiscalisation for local invoices; VAT registration and
   place-of-supply rules in each diaspora market. Either the provider handles this or CarUp does.

---

## 3. Options considered

### A. Stripe Billing
- **Eligibility:** Zimbabwe is **not** a supported Stripe merchant country. Requires an operating entity
  in a supported jurisdiction (UK / US / EU / South Africa / Australia are all live for CarUp's user
  geography). This is the option's single blocking condition.
- **Rails:** cards, wallets, and local methods per market. **No EcoCash / Zimbabwe mobile money.**
- **Subscriptions:** best-in-class. Schedules, trials, proration, Smart Retries dunning, customer
  portal, hosted invoices, Stripe Tax.
- **Webhooks:** HMAC signature over `timestamp.rawBody`, stable `evt_` ids, automatic retries with
  backoff, dashboard replay, and a full read API to reconcile against. Ordering not guaranteed —
  documented as such by Stripe itself.
- **Refunds/disputes:** first-class, with evidence submission APIs.
- **Fees:** card MDR plus a Billing percentage on recurring revenue; international-card and currency
  conversion surcharges apply to a materially international customer base.

### B. Paddle / Lemon Squeezy (merchant of record)
- **Eligibility:** MoR takes on the VAT/sales-tax burden entirely, which is genuinely attractive given
  five-plus tax jurisdictions. But an MoR underwrites the *seller*; a Zimbabwe-domiciled operating
  entity is unlikely to pass onboarding, and MoR payout rails to Zimbabwe are the same problem as (A).
- **Rails:** cards/wallets only. No mobile money.
- **Verdict:** solves tax, not eligibility or rails. Keeps the same Zimbabwe-side gap as Stripe while
  giving up control over the subscription object and the dunning policy.

### C. Flutterwave / Paystack (pan-African PSPs)
- **Eligibility:** strong in Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire, Egypt. Zimbabwe is at
  best a partial/indirect market for both, and merchant onboarding for a Zimbabwe entity is not a
  documented, self-serve path.
- **Subscriptions:** plans/subscriptions exist but are thinner than Stripe — proration and dunning in
  particular need to be built on our side.
- **Verdict:** genuinely good for African card + some mobile money, but does not clear the eligibility
  bar for the exact country that matters here.

### D. DPO Group (Network International)
- **Eligibility:** operates in Zimbabwe; supports cards plus mobile money including EcoCash.
- **Subscriptions:** recurring exists but is token/charge-oriented rather than a full subscription
  lifecycle. Dunning, proration and invoice generation would be ours to build.
- **Webhooks:** callback quality is materially weaker than Stripe's — this is the category where
  reconciliation stops being a nicety.
- **Verdict:** a credible Zimbabwe rail, and the main alternative to (E).

### E. Paynow (Webdev, Zimbabwe)
- **Eligibility:** local aggregator, straightforward onboarding for a Zimbabwe entity.
- **Rails:** EcoCash, OneMoney, InnBucks, Zimswitch, Visa/Mastercard. Exactly the Zimbabwe-side coverage
  that (A)–(C) lack. USD and ZiG.
- **Subscriptions:** **none.** Paynow is a payment-initiation API, not a billing system. Recurring
  charges must be driven by CarUp on a schedule.
- **Webhooks:** a "result URL" callback with a hash over concatenated fields — verifiable, but there are
  **no stable event ids and no delivery guarantee**. The documented correct pattern is to treat the
  callback as a *hint* and poll the status URL for truth.
- **Verdict:** the right local collection rail, and the strongest argument in the whole ADR for building
  a reconciliation engine rather than trusting webhooks.

### F. Manual / offline (bank transfer, invoice, operator-marked)
- Already representable: `BILLING_PROVIDERS.MANUAL`. No fees, no eligibility problem, no automation.
- **Verdict:** not a primary provider, but it must never be removed — it is the only rail that works for
  enterprise/partner accounts and for any tenant a PSP declines.

---

## 4. Decision

**Stripe Billing is the recommended subscription system of record, with Paynow as the Zimbabwe-resident
collection rail, and Manual retained permanently as a third path.**

Specifically:

1. **Stripe holds the subscription object** for every tenant it is eligible to bill — plan, period,
   status, proration, dunning, invoices, tax. This is where the hardest-to-rebuild logic lives, and
   Stripe is the only option in §3 that supplies all of it.
2. **Paynow collects from Zimbabwe-resident tenants** where Stripe cannot reach them. Because Paynow has
   no subscription concept, CarUp drives the renewal schedule and *our* `diaspora_subscriptions` row
   stays the tenant-facing truth for those tenants; Paynow supplies only "did this period's payment
   settle".
3. **Manual stays** for enterprise, partner and declined-tenant cases.
4. **Stripe's eligibility precondition is explicit and unresolved:** it requires an operating entity in
   a supported country. If the owner determines that no such entity will exist, the fallback
   recommendation is **DPO Group (§3D) as the single provider**, accepting that dunning, proration and
   invoicing move in-house. That is a materially worse engineering outcome, which is why the entity
   question is listed first in §9.

### Why the split is not a hedge

A single provider would be simpler, and the two-rail answer is only justified because the alternative is
worse in a concrete way: a Stripe-only choice cannot bill Zimbabwe sellers *at all* (not "with higher
fees" — at all), and a Paynow-only choice means writing a subscription engine, a dunning engine and a
tax/invoice pipeline for the diaspora side, each of which is a known source of revenue-affecting bugs.

---

## 5. The adapter stays provider-neutral regardless

**This is the load-bearing part of the ADR, and it holds no matter which provider §4 resolves to —
including if the owner rejects the recommendation entirely.**

The codebase does not know what a provider is called. Every capability is expressed through
`BillingProvider` (`backend/services/diaspora/billing/billingProvider.js`), whose methods take and return
**CarUp-shaped** objects:

```
createCheckoutSession · createPortalSession · syncSubscription · getSubscription
verifyWebhook · normalizeEvent · getInvoiceState · cancelSubscription · changePlan · handleTrial
```

Provider vocabulary is confined to exactly one module — `billingProviderProfiles.js`. A *profile* owns:

- the URL, HTTP method, content type and body encoding of each call;
- the parsing of each response into the CarUp-shaped object;
- the signature scheme (which header, which algorithm, what bytes are signed);
- the event-name mapping into CarUp's normalized event vocabulary.

Two profiles ship today — one Stripe-shaped (JSON REST, form-encoded bodies, `t=…,v1=…` signature over
`timestamp.rawBody`, `evt_` ids) and one Paynow-shaped (form-encoded POST, form-encoded *response*,
SHA-512 hash over concatenated values, **no event ids**). They exist together deliberately: two wire
contracts that could hardly be less alike, driven through one adapter, producing one normalized result,
is the only convincing proof that the neutrality claim is real rather than aspirational. The Paynow
profile in particular forces the ledger to handle providers that supply no event id and no ordering
signal, which is the case that breaks naive implementations.

Adding a third provider means adding a profile and an entry in `BILLING_PROVIDERS`. It must not require
touching the ledger, the reconciliation engine, the entitlement guard, the routes or the database schema.
If a future provider *does* require touching those, that is a defect in the abstraction, not an
acceptable cost.

### Rules that keep it neutral

- No provider identifier may appear outside `diasporaBillingConstants.js` and `billingProviderProfiles.js`
  — not in a service, not in a route, not in a column name, not in a test assertion about behaviour.
- No provider-shaped field name (`sub_…`, `cs_…`, `pollurl`, `evt_`) may cross the adapter boundary.
  Everything is normalized at the profile edge.
- The database stores `provider` as free text plus opaque `provider_customer_ref` /
  `provider_subscription_ref`. No schema change is needed to add a provider.
- Provider state is never trusted as an *entitlement* decision. It syncs into `diaspora_subscriptions`,
  and entitlements resolve from that row. A provider outage cannot silently escalate or revoke a plan.

---

## 6. Test mode

Engineering proceeds in **provider test mode**, which is not the same thing as the in-memory sandbox:

| | Sandbox | Test mode | Live |
|---|---|---|---|
| Wire contract exercised | No | **Yes** | Yes |
| Network in unit tests | No | **No** (injected transport) | n/a |
| Real money | No | No | Yes |
| Requires merchant credentials | No | Test keys only | Live keys |
| Enabled by | default | `DIASPORA_BILLING_TEST_MODE=true` | `DIASPORA_BILLING_LIVE=true` + approved provider |

The test-mode adapter builds and sends **real provider-shaped requests** — correct paths, headers,
encodings and signatures — through an **injected HTTP transport**. In tests the transport is a recording
fake, so the wire contract is asserted byte-for-byte while nothing touches a network. Pointing the same
adapter at the provider's real sandbox host is a transport swap and an environment variable, not a code
change. This is what stops "we'll wire the real provider later" from hiding an unwritten integration.

Fail-closed rules, all enforced in `diasporaBillingConstants.js`:

- Test mode is **refused in production** — a production process must never talk to a provider sandbox.
- A test-mode API key that does not carry a recognised test-key marker is refused.
- `DIASPORA_BILLING_LIVE=true` with an empty/unapproved `APPROVED_LIVE_PROVIDERS` throws rather than
  silently downgrading to sandbox.
- Live provider classes remain `EXTERNAL_ACTIVATION_REQUIRED` stubs. Nothing in this ADR moves money.

---

## 7. Consequences

**Accepted:**

- Two collection rails means two reconciliation surfaces and two signature schemes. Contained by §5.
- Paynow's lack of subscription support means CarUp owns the renewal schedule for Zimbabwe tenants. That
  work is real and is not yet built (see §8).
- Webhook ordering is unreliable everywhere, and on Paynow there is no event id at all. The ledger
  therefore records `occurred_at` / `provider_sequence`, marks out-of-order events **superseded** rather
  than applying them backwards, and dedupes on a unique `(provider, event_id)` claim. For a provider
  without event ids the profile synthesises a stable idempotency key from the payload, so the same
  guarantee holds.
- Mobile money has no chargebacks, so a "refund" is an outbound payment and an operational decision, not
  an API call. Reconciliation mismatches on that rail are the primary detection mechanism.
- Reconciliation is **not optional**. On a rail whose callback is explicitly documented as unreliable, a
  scheduled provider-vs-ledger comparison is the only thing that makes billing state trustworthy.

**Rejected on purpose:**

- Building our own card vault or storing PAN data — never, under any provider.
- Letting a webhook payload set entitlements directly. It syncs the subscription row; entitlements
  resolve from that row and the plan catalog.
- Treating a provider's "active" as sufficient for access without a period-end check.

---

## 8. What this ADR does **not** decide

- The Zimbabwe-side renewal scheduler (Paynow has no subscriptions; someone must trigger each period).
- Price points, currency of display, or FX policy between USD list prices and GBP/ZAR settlement.
- Whether the diaspora entity is UK, US, ZA or AU — that is a corporate decision with tax consequences.
- Fiscalisation/invoice format for ZIMRA compliance on the Zimbabwe rail.

## 9. Owner-only external actions before any live provider is approved

1. Confirm the operating entity and its country of incorporation (this gates §4 entirely).
2. Obtain the merchant account and **test-mode** API keys; approve plans, prices and currencies.
3. Confirm settlement accounts and exchange-control treatment for each settlement currency.
4. Confirm tax registration and invoice-format obligations per jurisdiction.
5. Authorize production money movement — separately from all of the above.

Until (1)–(5) are complete, `APPROVED_LIVE_PROVIDERS` stays empty, live selection throws
`EXTERNAL_ACTIVATION_REQUIRED`, and every path in the system is either sandbox or test mode.
