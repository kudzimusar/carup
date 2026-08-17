# CF1 — Cloudflare Free infrastructure migration plan

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Status:** **BLOCKED before the zone can even be built** — no Cloudflare credentials exist in this
environment (no `CLOUDFLARE_API_TOKEN`, no `~/.wrangler` auth, no token in any env file). The
nameserver cutover was always an owner gate; zone creation turns out to be one too.

Nothing has been changed in DNS. Vercel remains authoritative and every record below is live.

## Live inventory (authoritative — captured from the Vercel API)

19 records: 7 Vercel-managed, 12 owner-created.

| Type | Name | Value | Owner |
|---|---|---|---|
| ALIAS | `@` | `5d789d7e61c51256.vercel-dns-017.com` | system |
| ALIAS | `*` | `cname.vercel-dns-016.com.` | system |
| HTTPS | `@` | `. ech=<vercel-managed>` (prio 1) | system |
| HTTPS | `*` | `. ech=<vercel-managed>` (prio 1) | system |
| CAA | `@` | `0 issue "pki.goog"` | system |
| CAA | `@` | `0 issue "sectigo.com"` | system |
| CAA | `@` | `0 issue "letsencrypt.org"` | system |
| MX | `mail` | `inbound-smtp.ap-northeast-1.amazonaws.com.` | Resend inbound |
| TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEB…` | Resend DKIM |
| MX | `send.mail` | `feedback-smtp.ap-northeast-1.amazonses.com.` | Resend return-path |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | Resend SPF |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none;` | CarUp |
| TXT | `marketing` | `brevo-code:9bd6a09fa7de6b36357bc59c7e850bf5` | Brevo verification |
| CNAME | `brevo1._domainkey.marketing` | `b1.marketing-carup-dev.dkim.brevo.com.` | Brevo DKIM |
| CNAME | `brevo2._domainkey.marketing` | `b2.marketing-carup-dev.dkim.brevo.com.` | Brevo DKIM |
| TXT | `_dmarc.marketing` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | Brevo |
| CNAME | `links.marketing` | `links-marketing-carup-dev.brand.brevosend.com.` | Brevo branded links |
| CNAME | `img.links.marketing` | `links-marketing-carup-dev.img.brand.brevosend.com.` | Brevo branded links |
| CNAME | `r.links.marketing` | `links-marketing-carup-dev.r.brand.brevosend.com.` | Brevo branded links |

**DNSSEC: not enabled.** No `DS` record is published at the registry, so the cutover does not
require a DNSSEC teardown/re-key dance. It must stay disabled during cutover and may only be
re-enabled afterwards using Cloudflare's own DS record.

Registrar: Vercel (`serviceType: zeit.world`), expiry 2027-07-27, auto-renew on.
Nameservers: `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.

## The finding that most affects this migration

**The four canonical application hostnames do not exist as individual DNS records.** They are
served by exactly two Vercel-managed records:

- `ALIAS @` → the apex (`carup.dev`)
- `ALIAS *` → the wildcard, which is what currently answers `api.carup.dev`,
  `staging.carup.dev` and `api-staging.carup.dev`

A naive "copy every record" migration reproduces this correctly only if the wildcard is preserved.
Cloudflare has no `ALIAS` type; the equivalents are:

- apex → `CNAME @ → cname.vercel-dns.com` relying on Cloudflare's **CNAME flattening** (supported
  on Free), or the A records Vercel publishes;
- wildcard → `CNAME * → cname.vercel-dns.com`.

Recommended, and safer than relying on a wildcard across a provider change: create **explicit
records for each of the four hostnames** in Cloudflare *in addition to* the wildcard, so each
canonical surface resolves on its own merit and a wildcard subtlety cannot silently break one of
them. All four must be **DNS-only (grey cloud)** — no proxying, no WAF in front of Vercel, per the
frozen architecture.

`HTTPS`/`ech` records are Vercel-managed edge hints; Cloudflare generates its own. They should not
be hand-copied.

## Migration steps once Cloudflare access exists

1. Create the `carup.dev` zone on Cloudflare **Free**. Do not change nameservers yet.
2. Recreate all 12 owner-created records byte-for-byte (Resend + Brevo blocks above). These are
   the records that keep Email working; any typo silently breaks sending or authentication.
3. Recreate application reachability: `CNAME @` (flattened) plus explicit `api`, `staging`,
   `api-staging`, plus the `*` wildcard — **all DNS-only**.
4. Recreate the three `CAA` records so certificate issuance keeps working for both Vercel and,
   later, Cloudflare.
5. Verify in Cloudflare's zone view that all of the above resolve as expected *before* cutover,
   using Cloudflare's own resolver rather than public DNS (which still answers from Vercel).
6. **Owner gate — nameserver cutover.** Only after explicit approval.
7. Post-cutover verification: all four app surfaces, Resend send + inbound, Brevo authentication,
   and DMARC/SPF/DKIM resolution.
8. Enable Cloudflare Email Routing and create the human aliases.
9. **Only after those aliases physically receive mail**, migrate the `@carup.co.zw` legal/contact
   copy. Not before — those are legally-required contact channels.

## Human aliases (step 8, not yet created)

```text
support@carup.dev   security@carup.dev   privacy@carup.dev   legal@carup.dev
dpo@carup.dev       info@carup.dev       press@carup.dev
```

Cloudflare Email Routing is for **human** mail only. It must never become CarUp's automated
customer outbound transport on the Free plan — that remains Resend.

Once `dpo@`/`privacy@` physically deliver, CF1 should also add `rua=` to `_dmarc.mail.carup.dev`
and publish a root `_dmarc.carup.dev`. The `rua` was deliberately omitted at E1 because
advertising a non-delivering reporting address is the same failure class as the dead `carup.app`
and `carup.co.zw` domains this programme already had to fix.

## Risk notes

- Cutover is the highest-risk step in the whole programme: it moves authority for a zone that now
  carries live application traffic **and** two Email providers' authentication. Parity must be
  proven in Cloudflare before the switch, and the Vercel zone must not be deleted afterwards until
  cutover is proven stable.
- Propagation is not instant. Both zones will briefly serve, so they must be identical.
- Brevo and Resend both re-verify domains periodically; a missing DKIM/verification record after
  cutover degrades or halts Email silently rather than loudly.
