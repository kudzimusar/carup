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

---

## Addendum — 2026-08-17: reported results vs live evidence

The owner reported the mailbox certification as complete. Live database evidence agrees on one
item and contradicts two others. Recording this rather than accepting the reported status, because
the whole programme has run on the rule that live evidence overrides.

### Confirmed

**`ER4_ROUTING_EMAIL_ARRIVED=YES` / `RESEND_BRANDED_RENDERING=PASS`** — consistent with the
server-side evidence already captured (notification 330 `delivered`, Cloudflare MX accepted). These
are exactly the facts only a mailbox can supply, and nothing contradicts them.

### Contradicted — no inbound conversational reply exists

```text
messages (direction=inbound, channel=email)   0
email_reply_tokens issued (before this run)   0
resend email.received events                  1  -> rejected/invalid_signature (our own forged probe)
```

**Root cause is ours, not the owner's.** Every email this programme had sent was
*auth/security* classification — password reset and password-changed. Those deliberately carry no
conversation Reply-To. **No conversational email with a `conversation+<token>@mail.carup.dev`
Reply-To had ever been sent**, so there was nothing in the mailbox whose reply could route back to
a canonical thread. A reply to those messages would have gone to `auth@mail.carup.dev`.

Remediated in this run by creating the missing canonical conversation and sending a genuine
conversational message:

```text
thread          9b0383f2-9a94-4db5-af15-a2f6a02f305e
participant     3940882f-b0fd-497a-8ffd-bb0e4f59e733
binding         email / resend / conversation, can_send + can_receive
reply token     6db499d2-0a9e-4907-a73c-2245a612240b  (hash-only, 90-day expiry)
Reply-To        conversation+<opaque-token>@mail.carup.dev
notification    331
```

The reply round-trip therefore remains **UNPROVEN** and needs one more mailbox action once that
message arrives.

### Contradicted — the Brevo marketing path was never exercised through CarUp

```text
message_delivery_attempts where provider='brevo'      0
notification_queue where classification='marketing'   0
communication_suppressions                            0   (an unsubscribe via CarUp would create one)
communication_preferences row for the cert account    NONE
brevo webhook_logs                                    3   -> all our own forged 403 probes
campaigns                                             4   -> all pre-existing (3 in_app, 1 whatsapp)
```

CarUp holds no record of a marketing opt-in, no governed campaign, no Brevo delivery attempt and no
suppression. Whatever was received, it did not travel the required path:

```text
CarUp consent -> CarUp campaign -> CarUp eligibility -> Brevo projection -> send
```

The directive is explicit that Brevo list membership must never be the authority, and that the
controlled inbox must not be added to Brevo directly to manufacture a PASS. So
`BREVO_OPT_IN_COMPLETED` / `BREVO_RENDERING` / `BREVO_UNSUBSCRIBE` **cannot be certified** —
not because the owner did not act, but because the canonical chain that E7 requires produced no
evidence. This needs to be re-run through the CarUp preference and campaign path.

### Blocked — permanent alias destinations were not supplied

The instruction contained unsubstituted template placeholders:

```text
REGULATORY_SECURITY_DESTINATION=<REAL EMAIL ADDRESS>
OPERATIONS_DESTINATION=<REAL EMAIL ADDRESS>
```

No destination was created and no permanent alias was created. Routing `privacy@`, `dpo@` and
`legal@` — statutory contact channels — to a placeholder or a guessed address would be materially
worse than the current state, so nothing was invented. The `routing-certification@carup.dev`
alias remains in place pending that decision.

---

## E7 Brevo marketing — now certified through the governed path

The earlier addendum recorded that no Brevo evidence existed because the canonical chain had never
been exercised. It has now been driven end to end, entirely through CarUp's own authority. The
controlled inbox was **never** added to a Brevo list directly.

### F1 — consent OFF → opt-in → governed campaign → real send

```text
1. preference row created with marketing_enabled = FALSE      (baseline, in CarUp)
2. opt-in recorded in CarUp:  marketing_enabled = TRUE, consented_at set
3. governed marketing template + campaign created and approved
   campaign 217ac5d8-00cd-48ff-91df-a3972638e9e5  classification=marketing  channel=email
4. eligibility evaluated FROM CarUp consent -> exactly 1 recipient
5. notification 332 queued carrying campaign_id + campaign_delivery_id
6. routed provider = BREVO (not Resend)
   provider message id <202608170906.76524245053@smtp-relay.mailin.fr>
   attempt status = sent, no errors
```

The router sent a marketing-classified message to Brevo and nothing else to Brevo, confirming the
classification split holds under a real send.

### F2 — replay produces zero additional sends

Replaying the same campaign/recipient was **rejected at the database level**:

```text
notifications for that dedupe key   1  (unchanged)
Brevo provider sends                1  (unchanged)
```

**Defect found and fixed while proving this.** `notification_queue.dedupe_key` had no unique
constraint — deduplication existed only as a read-then-write inside `queueNotification`, with no
locking. Two concurrent campaign executions, or a retried worker racing itself, could both pass the
check and insert, yielding two real provider sends for one canonical intent. That is exactly the
invariant the directive requires, so it is now guaranteed by the database:
`database/migrations/20260817180000_notification_dedupe_uniqueness.sql` adds a partial unique index
(partial because 187 legacy rows legitimately carry a NULL dedupe key; zero duplicate non-null
values existed, so it applied cleanly).

### F3 — withdrawal suppresses BEFORE any provider call

```text
1. consent withdrawn through CarUp: marketing_enabled = FALSE, withdrawn_at set
2. withdrawal reconciled into canonical communication_suppressions (reason=unsubscribe)
3. a FRESH campaign created and the same eligibility gate run
   eligible recipients                 0
   Brevo provider sends (total)        1   (unchanged — no second call was ever made)
   marketing notifications (total)     1   (unchanged)
```

Suppression is evaluated during eligibility, so no provider call is attempted at all — Brevo is
never asked and never gets the chance to decide. CarUp consent remains authoritative over provider
list state, as required.

### Still owner-observable only

Rendering of the received marketing message and the behaviour of its unsubscribe link can only be
confirmed from the mailbox. The send itself, its provider identity, its idempotency and the
suppression behaviour are all certified above from server-side evidence.

---

## Final gate attempt — 2026-08-17: two provider-configuration defects

### Permanent human aliases — BLOCKED by Cloudflare, not by choice

`buynsellpvtltd@gmail.com` was added as a Cloudflare Email Routing destination. Cloudflare
created it **unverified** and emailed a confirmation link to that mailbox.

All seven alias creations were then attempted and **all seven were refused by Cloudflare**:

```text
security@ privacy@ legal@ dpo@ support@ info@ press@   ->  "Destination address is not verified"
```

This is a Cloudflare-side constraint, not a design decision: routing rules cannot target an
unverified destination. No catch-all was created. The temporary `routing-certification@carup.dev`
alias is deliberately retained, because retiring it before permanent routing works would leave the
domain with no proven inbound path at all.

### Inbound conversational reply — still not received by CarUp

```text
resend email.received events (legitimate)   0   (the single logged one is our own forged probe at 03:45)
inbound email messages                      0
reply token use_count                       0   (never resolved)
recent resend events                        email.sent, email.delivered only
```

The outbound side is confirmed working — notification 331 delivered with a
`conversation+<opaque-token>@mail.carup.dev` Reply-To. The reply was reportedly sent, but **no
`email.received` event has ever reached the webhook**, so nothing entered the inbound path and
there is nothing to resolve.

DNS is correct (`mail.carup.dev` MX → `inbound-smtp.ap-northeast-1.amazonaws.com`), so the gap is
in Resend's inbound configuration — either receiving is not actually routing to the webhook
endpoint, or the endpoint is not subscribed to `email.received`. That configuration is only
visible from the Resend dashboard.

**Consequence:** the same-thread / same-participant inbound invariants remain proven at source
level across eleven scenarios, but **not** physically. This is recorded as unproven rather than
inferred from the outbound success.

### Brevo lifecycle — real events arriving, all rejected

This is the most consequential finding of the final pass. Genuine Brevo events for the
certification campaign reached the endpoint:

```text
09:06:10  request         tag campaign:217ac5d8-00cd-48ff-91df-a3972638e9e5   rejected/invalid_signature
09:06:11  unique_opened   tag campaign:217ac5d8-…                             rejected/invalid_signature
09:06:21  delivered       tag campaign:217ac5d8-…                             rejected/invalid_signature
```

Two things follow.

**Good news:** `delivered` and `unique_opened` are independent provider confirmation that the
governed marketing message reached the inbox and was opened — corroborating the reported rendering
PASS from the server side.

**The defect:** every one of those events was rejected as `invalid_signature`, so **no Brevo
lifecycle state reconciles into CarUp**. The registered webhook is not presenting the shared secret
in either form the implementation accepts (`x-carup-brevo-secret` / `x-brevo-webhook-secret`
header, or `?token=` query parameter). The authentication itself is behaving correctly — it is
failing closed on an unauthenticated request, exactly as designed — but the registration and the
implementation disagree.

The suppression currently in `communication_suppressions` came from the **CarUp-side** withdrawal
(F3), not from the provider webhook. So CarUp's consent authority is intact and the withdrawal is
correctly enforced; what is missing is the provider→CarUp reconciliation path.

Nothing was weakened to make these pass. Fixing this requires re-registering the Brevo webhook URL
with the shared secret, after which the lifecycle and unsubscribe reconciliation can be certified.
