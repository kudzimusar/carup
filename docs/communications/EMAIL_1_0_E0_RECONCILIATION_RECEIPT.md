# CarUp Email 1.0 — E0 Live Reconciliation Receipt

**Date:** 2026-08-16 (UTC)
**Programme:** CarUp Email 1.0 (single-run directive: `CARUP_EMAIL_1_0_SINGLE_RUN_CLAUDE_DIRECTIVE.md`)
**Branch:** `feat/communications-email-transport`
**E0 result:** PASS after owner lane authorization (initially BLOCKED on write lane; owner authorized Email as the single active writable lane on 2026-08-16)

## Lane state at authorization

```text
MAIN_SHA=f9c6f80d10a80c21e8e01abb7f26a483caa29e88          (unmoved from directive baseline)
EMAIL_BRANCH_BASE=7d3b0280d87cd8024b5a4dbf07b12e71d8b0b35b (main + directive doc only)
PR_161_WRITE_STATE=PAUSED (owner decision 2026-08-16)
PR_161_FROZEN_HEAD=27bab759a41e13e629786055b3b0405d91ee918c
OTHER_OPEN_DRAFTS=#137, #124, #123 (stale, parked)
EMAIL_WRITE_STATE=ACTIVE (single writable lane)
```

PR #161 (`feat/owner-dashboard-electric-redesign`) is paused, not closed. It must not be
closed, merged, modified, rebased, or used as a source branch by this programme.

## Live infrastructure baseline

```text
STAGING_FRONTEND_DEPLOYMENT=dpl_32qDFTRFQkLmfidWYc3FB1bK6uiD (carup-staging)
STAGING_FRONTEND_SHA=f9c6f80d (exact main)
STAGING_BACKEND_DEPLOYMENT=dpl_D6cwv3eW4g3qjBTz5ZbT3jRvzmrU (carup-backend-staging)
STAGING_BACKEND_SHA=f9c6f80d (exact main)
STAGING_BACKEND_HEALTH=UP; communications readiness BLOCKED on missing email creds (expected)
CARUP_STAGING_DB_IDENTITY=eoyenigwevnxwwhyhaer.supabase.co
DB_MIGRATION_PARITY=full (Communications 2.0 chain + issue101 hardening applied)
DNS_AUTHORITATIVE=Vercel DNS (ns1/ns2.vercel-dns.com) — no nameserver cutover needed or authorized
DNS_EMAIL_RECORDS=none (no MX/SPF/DKIM/DMARC on carup.dev, mail.carup.dev, marketing.carup.dev)
```

## Email data topology (staging DB, read-only inventory)

```text
EMAIL_IDENTITIES=0
EMAIL_BINDINGS=0
EMAIL_CAMPAIGNS=0 / EMAIL_CAMPAIGN_DELIVERIES=0
SUPPRESSION_TABLE=absent from schema
LEGACY_RESIDUE=16 dead-letter email notification_queue rows,
               16 failed sendgrid message_delivery_attempts,
               16 outbound email messages (provider NULL)
BASELINE_COUNTS=threads 42 / messages 151 / notification_queue 302
               (exactly matches certified post-PR#148 baseline)
EMAIL_DUPLICATE_RISKS=none possible (empty topology; no identity merge/backfill required)
```

## Source inventory findings (key ones)

- Email adapters: `SendGridEmailAdapter` (text/plain only, receipts-only) and
  `CloudflareEmailAdapter` (worker/REST dual-mode) in
  `backend/services/communication/adapters/providerAdapters.js`; selected by a single
  `EMAIL_PROVIDER` ternary — one adapter per channel, no classification routing.
- No Resend or Brevo adapter, SDK, env var, or credential exists anywhere in the repo,
  local env files, or staging Vercel projects.
- Outbound email never persists an RFC Message-ID as `provider_message_id`, so the
  `resolveProviderReplyContext` same-thread bridge (used by WhatsApp) is inert for email.
- Inbound email exists only via the Cloudflare edge worker
  (`cloudflare/carup-communications-edge`) into the HMAC-verified
  `/api/communications/webhooks/cloudflare/email` route.
- The shared inbound resolver (`communicationInboundService.js`) carries the Gate-E
  participant-reuse invariant and provider-message dedupe; email inherits it.
- Governed templates: 20 active (12 transactional / 6 service / 2 marketing); seeds are all
  `channel='default'`; 3 email-channel versions exist in staging DB only.
- `EMAIL_PROVIDER_FALLBACK` is surfaced in health but never acted upon.
- `web/src/features/communications/channelRegistry.ts` hardcodes `sendgrid` and its
  webhook path in the UI.
- `message_delivery_attempts` has an index but no unique constraint on
  `(provider, provider_message_id)`.

## Owner-approved design decisions (frozen)

1. Reuse the Communications 2.0 conversation architecture; no Email-owned conversation tables.
2. One additive Email migration unless implementation proves more unavoidable.
3. No identity merge/backfill (topology empty).
4. Resend = canonical transactional/conversational transport; Brevo = canonical marketing
   transport; provider chosen by governed classification, never caller choice.
5. CarUp remains authoritative for consent, campaigns, suppression and routing.
6. Persist Resend provider request ID and RFC Message-ID for durable reply correlation.
7. Inbound reply routing: authenticated opaque Reply-To token + RFC Message-ID correlation;
   when both signals exist they must independently resolve and agree; ambiguous inbound
   fails closed; Gate-E same-thread/same-participant invariant preserved.
8. SendGrid deprecated from canonical routing; Cloudflare application-send quarantined from
   canonical routing (non-conflicting infrastructure preserved).
9. DNS stays authoritative on Vercel; `mail.carup.dev` → Resend, `marketing.carup.dev` → Brevo;
   no duplicate SPF/DMARC records; conservative DMARC (`p=none`) initially.
10. Production Communications remains INACTIVE. WhatsApp untouched. Telegram not started.
11. Final Email PR merges only on explicit owner authorization.
