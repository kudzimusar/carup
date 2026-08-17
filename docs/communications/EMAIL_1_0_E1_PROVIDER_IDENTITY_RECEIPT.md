# CarUp Email 1.0 — E1 DNS & Provider Identity Receipt

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Governing contract:** `CARUP_EMAIL_1_0_SINGLE_RUN_CLAUDE_DIRECTIVE.md` §7 (E1) as amended by **§0A** (free-tier provider allocation)

## Free-tier allocation (owner-frozen)

| Provider | Domain | Role | Free ceiling (2026-08) |
|---|---|---|---|
| **Resend** | `mail.carup.dev` | transactional + conversational, inbound replies, lifecycle | 100/day |
| **Brevo** | `marketing.carup.dev` | marketing only — never a competing transactional provider | ~300/day |
| **Cloudflare** | `carup.dev` root | DNS + **human** Email Routing aliases only | n/a (Free plan) |
| **Vercel** | four canonical app hostnames | application hosting; stays DNS-only under Cloudflare | n/a |

Cloudflare must never become canonical automated customer outbound on the Free plan.

## Resend — VERIFIED (no physical Email sent)

Authoritative zone `carup.dev` is still Vercel-hosted (Cloudflare migration is CF1, not yet run).
All Resend records confirmed present both in the authoritative Vercel zone and via public
resolution (`@8.8.8.8`). Region: `ap-northeast-1`.

```text
MX   mail.carup.dev              10 inbound-smtp.ap-northeast-1.amazonaws.com.   (inbound receiving)
TXT  resend._domainkey.mail      p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDSIInM7…  (DKIM)
MX   send.mail.carup.dev         10 feedback-smtp.ap-northeast-1.amazonses.com.  (return-path / bounces)
TXT  send.mail.carup.dev         v=spf1 include:amazonses.com ~all               (SPF)
TXT  _dmarc.mail.carup.dev       v=DMARC1; p=none;                               (added in this phase)
```

Staging secret state on `carup-backend-staging` (**presence only — values never read or printed**;
both are stored encrypted and are correctly not retrievable via `vercel env pull`):

```text
RESEND_API_KEY        PRESENT (encrypted)
RESEND_FROM_EMAIL     PRESENT (encrypted)
RESEND_WEBHOOK_SECRET ABSENT  → required for E3 lifecycle webhooks
```

```text
DOMAIN_READY=YES              (carup.dev authoritative, verified, Vercel-hosted)
RESEND_DOMAIN_READY=YES       (DKIM + SPF + return-path published)
RESEND_RECEIVING_READY=YES    (inbound MX published)
BREVO_DOMAIN_READY=NO         (no account/records yet — owner gate)
SPF=v=spf1 include:amazonses.com ~all   (on send.mail.carup.dev, per Resend's layout)
DKIM=resend._domainkey.mail.carup.dev   (RSA key published)
DMARC=v=DMARC1; p=none;                 (on _dmarc.mail.carup.dev)
E1_RESULT=BLOCKED (Brevo account/domain setup only — every Resend-side and Brevo-independent step complete)
```

### DMARC decision: `p=none` with **no** `rua=` yet — deliberate

The directive calls for conservative monitoring initially, and no stricter policy existed to
weaken. A reporting address was **intentionally omitted** rather than guessed: the aggregate-report
mailbox would have to be one of the human aliases (`dpo@`, `privacy@`), and **those aliases do not
exist yet** — they are created and proven in CF1 (§0A.5 steps 13–14).

Publishing `rua=mailto:dpo@carup.dev` today would advertise a non-delivering address. That is
precisely the failure class this programme has already had to fix twice (`carup.app` in the
referral engine, `carup.co.zw` in the share endpoint), so it is not repeated here.

**CF1 must add `rua=` to this record once the aliases physically deliver,** and should add a root
`_dmarc.carup.dev` at the same time (root email posture belongs to CF1, since Cloudflare Email
Routing is what gives the root domain a mail identity).

## Brevo — NOT STARTED (owner gate)

`marketing.carup.dev` currently has no MX, TXT, or DKIM records, and no `BREVO_*` secrets exist on
any project. Brevo has **no Vercel Marketplace listing** (verified via `vercel integration
discover`), so it requires direct signup at brevo.com. This is the E1 blocking gate.

## Cost governance — IMPLEMENTED (Brevo-independent)

`backend/config/emailProviderQuota.js` + `backend/tests/email-provider-quota.test.js` (10/10 pass).

- Configurable via `RESEND_DAILY_SOFT_LIMIT`, `RESEND_DAILY_CRITICAL_LIMIT`,
  `BREVO_DAILY_SOFT_LIMIT`, `BREVO_DAILY_CRITICAL_LIMIT`; documented in both env templates.
- Defaults sit **below** the provider ceilings (Resend 70/90 of 100; Brevo 210/270 of 300) so
  CarUp reacts before the provider does.
- Soft threshold warns and audits but never blocks.
- Critical threshold preserves security/transactional/conversational capacity, defers
  service-class and unclassified Email, and **suppresses marketing first**.
- `autoPurchase` is `false` on every decision path — proven exhaustively across all
  classification × usage combinations.
- A misconfigured or inverted threshold falls back to safe defaults rather than silently
  disabling protection.
- Provider ceilings are recorded as *operational configuration*, explicitly not permanent
  business logic.

The module is pure policy — it never calls a provider, never buys capacity, and never escalates
a plan. Enforcement wiring into the delivery worker and campaign service happens in E2/E5, where
the send path exists.

## Not done in this phase (deliberate)

- **No physical Email sent.** E1 is configuration and identity only.
- **No nameserver change.** Cloudflare migration is CF1, gated on explicit owner approval.
- **`EMAIL_PROVIDER` is still unset**, so the adapter registry continues to default to SendGrid,
  which has no credentials — this is why staging Communications health reports `BLOCKED` on
  `SENDGRID_API_KEY`. That is the pre-existing baseline and is resolved in E2, when the
  classification-based Resend router replaces the single-provider ternary.
- **No `@carup.co.zw` contact-address change.** Blocked on CF1 aliases physically delivering; the
  required alias list is in `docs/CARUP_DOMAIN_CANONICALIZATION_RECEIPT.md`.
