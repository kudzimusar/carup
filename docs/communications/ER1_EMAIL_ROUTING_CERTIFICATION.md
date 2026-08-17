# ER — Cloudflare Email Routing (root human aliases)

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17

Provider allocation is unchanged and was explicitly re-verified after every mutation:

```text
carup.dev root        Cloudflare Email Routing — HUMAN inbound aliases only
mail.carup.dev        Resend — transactional / conversational / auth + canonical inbound replies
marketing.carup.dev   Brevo  — marketing only
```

## ER1 — pre-mutation reconciliation

| Item | Finding |
|---|---|
| Root MX | **none** — zero records, so no collision with any existing mail flow |
| Root SPF / DKIM / DMARC | none |
| Email Routing status | `unconfigured`, not enabled |
| Existing routing rules | none (only a disabled catch-all placeholder) |
| Destination addresses | `eleven.eleven.testing@gmail.com` — **already verified** |
| `mail.carup.dev` | inbound MX, `resend._domainkey` DKIM, `send.mail` SPF + return-path MX, `_dmarc.mail` — all present |
| `marketing.carup.dev` | brevo-code TXT, `brevo1`/`brevo2` DKIM, `_dmarc.marketing`, `links`/`img.links`/`r.links` — all present |

**Collision check: clean.** Root email records and the two provider subdomains occupy disjoint
namespaces, so onboarding root routing cannot shadow Resend or Brevo.

One observation worth recording: the wildcard `*.carup.dev` CNAME answers for *any* undefined root
subdomain, so lookups like `_dmarc.carup.dev` return a CNAME to Vercel rather than NXDOMAIN. This
is cosmetically untidy but harmless — explicit records always win over a wildcard, and the routing
records below are explicit.

## ER2 — root onboarding

Email Routing enabled: `enabled: true`, `status: ready`. Cloudflare added exactly its required
root records:

```text
MX   carup.dev                     route1.mx.cloudflare.net  (prio 67)
MX   carup.dev                     route2.mx.cloudflare.net  (prio 57)
MX   carup.dev                     route3.mx.cloudflare.net  (prio 21)
TXT  carup.dev                     v=spf1 include:_spf.mx.cloudflare.net ~all
TXT  cf2024-1._domainkey.carup.dev v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkq…
```

**Provider isolation re-verified after onboarding — all unchanged:**

```text
Resend  mail MX            10 inbound-smtp.ap-northeast-1.amazonaws.com
        resend._domainkey  p=MIGfMA0GCSqGSIb3DQEBAQUAA4G…
        send.mail SPF      v=spf1 include:amazonses.com ~all
        send.mail MX       10 feedback-smtp.ap-northeast-1.amazonses.com
        _dmarc.mail        v=DMARC1; p=none;
Brevo   marketing TXT      brevo-code:9bd6a09fa7de6b36357bc59c7e850bf5
        brevo1/2 DKIM      b1/b2.marketing-carup-dev.dkim.brevo.com
        _dmarc.marketing   v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com
        links/img/r        …brand.brevosend.com
```

## ER3 — certification destination

`eleven.eleven.testing@gmail.com` was **already Cloudflare-verified**, so no verification gate was
needed. It is used **only** to certify routing and is explicitly *not* approved as the permanent
destination for any human alias.

## ER4 — physical routing test

A temporary, clearly-named alias was created (not a production alias):

```text
rule tag   1b2e54ac2c8241c4835dd1561b2b7125
alias      routing-certification@carup.dev
forwards   eleven.eleven.testing@gmail.com
```

A **real external email** was then sent through CarUp's own canonical pipeline — deliberately not a
synthetic provider ping — so the test exercises the production path end to end:

| Field | Value |
|---|---|
| Sender | `CarUp Security <auth@mail.carup.dev>` (Resend) |
| Recipient | `routing-certification@carup.dev` (Cloudflare Email Routing) |
| Sent | 2026-08-17 08:22:16 UTC |
| Canonical notification | `330` — status **delivered** |
| Provider | `resend`, attempt status **delivered** |
| Provider request id | `d1ea9fee-c2b1-4d14-93b5-7b814a731a5c` |
| RFC Message-ID | `<010601a00ed12051-73ac8ff1-a3af-4e01-965f-5d…` |
| Errors | none |

**What this proves:** Resend reported `email.delivered` for a recipient at `carup.dev`, which means
Cloudflare's routing MX **accepted and acknowledged** the message. The DNS, MX and acceptance path
are certified.

**What it does not prove:** that Cloudflare then forwarded it into the Gmail inbox. That final hop
is only observable from the mailbox, so it is folded into the consolidated owner gate rather than
claimed.

Impact on Resend: none (it was the sender, and its own records are unchanged). Impact on Brevo:
none.

The temporary alias is **deliberately left enabled** until the mailbox arrival is confirmed —
removing it now would prevent a re-test. It is recorded for removal in E8 cleanup.

## ER5 — permanent human aliases: BLOCKED on an owner decision

The seven target aliases are **not created**, because creating them would require choosing a
destination, and no approved permanent destination exists.

Discovery across live CarUp configuration and product copy found:

- Real contact addresses in shipped product copy are all `@carup.co.zw`: `support@`, `privacy@`,
  `legal@`, `dpo@`, `info@`, `press@`, plus two named individuals — and that domain **does not
  resolve** (established earlier in this programme).
- Every `@carup.dev` human alias appears **only inside this programme's own planning documents**.
  That is aspiration, not an approved destination.
- The only Cloudflare-verified destination is the certification Gmail, which is explicitly not
  approved for permanent use.

Pointing legally-required contact channels (`privacy@`, `dpo@`, `legal@`) at a testing Gmail would
be worse than the current state, so it was not done.

No `@carup.co.zw` contact copy has been migrated, and none will be until the replacement aliases
physically deliver to an approved destination.
