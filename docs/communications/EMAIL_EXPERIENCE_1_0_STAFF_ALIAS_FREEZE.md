# CarUp human/staff email aliases — owner freeze

**Status:** OWNER-APPROVED AND AUTHORITATIVE. Frozen 2026-08-18.
**Programme state:** `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED` — documentation only. No infrastructure
was created by me, no source mutated, no PR opened.
**Routing status:** `INBOUND_ROUTING_CERTIFIED=YES` (owner physical evidence, 2026-08-18) · `OUTBOUND_SENDING_CONFIGURED=NO`

These are **human/staff correspondence aliases**. They are *not* automated Email transport identities and do
not participate in the Email 1.0 sender-persona system except where explicitly stated below.

---

## Approved aliases

| Alias | Owner display name | Public role | Purpose | Leadership-email eligible |
|---|---|---|---|---|
| `kudzie@carup.dev` | S.K Musarurwa | Co-Founder & Head of Development | personal leadership / business correspondence | **YES** |
| `king@carup.dev` | Kingston Musarurwa | Founder / COO | personal leadership / business correspondence | no |
| `questions@carup.dev` | CarUp Team | — | shared general questions / business correspondence | no |

Current forward destination for all three: `buynsellpvtltd@gmail.com`.

> **Forward destinations are operational configuration.** They may change without changing the public
> `@carup.dev` alias. Nothing in the email system may hardcode a forward destination — the public alias is the
> stable contract.

---

## Binding constraints

1. **These are human aliases, not transport identities.** They do not become `From` addresses for automated
   mail.
2. **They do not replace the seven certified functional aliases.** `support@`, `security@`, `privacy@`,
   `legal@`, `dpo@`, `info@`, `press@` remain the canonical functional contacts, and remain the targets of the
   authorized `@carup.co.zw` → `@carup.dev` functional mapping.
3. **`king@` and `kudzie@` must not be used for automated security, transactional, marketing or conversation
   transport** by default.
4. **`kudzie@` may later serve as a monitored Reply-To for specifically approved leadership communications** —
   on separate approval, not by default.
5. **`questions@` is not the canonical customer-support replacement.** Support remains `support@carup.dev` and
   `SUPPORT_URL`.
6. **No additional personal `@carup.dev` addresses may be fabricated.** This list is exhaustive.

### The B2 title is unchanged

> The phrase "founder/CEO account" in the alias context is **not** a B2 title change. S.K Musarurwa's frozen
> customer-facing title remains **Co-Founder & Head of Development**, and must never render as CEO.

### Kingston Musarurwa — recorded, not yet presentable

`Kingston Musarurwa / Founder / COO` is owner-supplied identity and is recorded here as such. **Do not add
website or customer-facing leadership presentation for this identity** until the institutional website
reconciliation lane authorizes it. It is not currently approved for any email signature, masthead or footer.

This also means the two named leadership identities are deliberately asymmetric: only S.K Musarurwa is
`leadership_email_eligible=YES` today.

---

## Interaction with the B2 leadership freeze

The B2 freeze set `LEADERSHIP_REPLY_TO = info@carup.dev`. That remains authoritative. `kudzie@carup.dev` is
recorded as **eligible** for leadership email but is **not** the current leadership Reply-To, and switching to
it requires the separate approval named in constraint 4.

Both are now physically certified for inbound delivery: `info@` in Email 1.0 E7 (real send, `delivered`), and
the three staff aliases by owner-confirmed physical arrival on 2026-08-18 — see below. Neither fact changes
`LEADERSHIP_REPLY_TO`, which stays `info@carup.dev` until separately approved.

---

## `INBOUND_ROUTING_CERTIFIED` — owner physical evidence, 2026-08-18

**Supersedes the previous `STAFF_ALIAS_ROUTING_PENDING` status.**

All three staff aliases are certified for **inbound routing**, on owner-performed physical delivery evidence.

| Alias | Destination | Result |
|---|---|---|
| `kudzie@carup.dev` | `buynsellpvtltd@gmail.com` | **ARRIVED** |
| `king@carup.dev` | `buynsellpvtltd@gmail.com` | **ARRIVED** |
| `questions@carup.dev` | `buynsellpvtltd@gmail.com` | **ARRIVED** |

### Negative control

```text
no-such-address-81826@carup.dev   ->   Address not found / delivery failed
```

Interpretation: no catch-all delivery occurred; an unmatched `@carup.dev` address is rejected; the
**catch-all posture remains effectively disabled**. This is the load-bearing half of the evidence — three
arrivals alone would not have proven the absence of a catch-all.

### Evidence basis, stated precisely

This certification rests on **owner-performed and owner-confirmed physical observation**, not on
instrumentation of mine. I created no routing rules and sent no test messages: no Cloudflare credential was
available, and I stopped rather than mutate (`STAFF_ALIAS_ROUTING_BLOCKED_CREDENTIAL_REQUIRED`).

What the owner's evidence proves *better* than a configuration read would: real messages traversed the real MX
and reached the real destination, and an unmatched address was genuinely rejected. Delivery is the stronger
proof.

What remains **unverified by me**: the live routing-rule inventory and the state of the seven functional
aliases. Those were last directly observed at the E8 cleanup on 2026-08-17 (seven enabled rules plus a
disabled catch-all). The negative control gives good independent evidence that the catch-all is still off, but
it says nothing about the seven functional rules. Recorded as an observation gap rather than assumed intact.

### What this does and does not authorize

```text
INBOUND_ROUTING_CERTIFIED   = YES
OUTBOUND_SENDING_CONFIGURED = NO
```

**These aliases cannot send mail.** Nothing here configures `From: kudzie@carup.dev`,
`From: king@carup.dev` or `From: questions@carup.dev`, and no such claim may be made. They remain human
correspondence addresses, not transport identities.

`LEADERSHIP_REPLY_TO` remains **`info@carup.dev`**, unchanged. The seven functional aliases, the catch-all
posture, Resend, Brevo, SPF/DKIM/DMARC, DNS/MX and production Communications are all unchanged by this task.

### Now publishable — with one caveat

The previous prohibition ("must not appear in any customer-facing surface until routed and certified") is
**lifted for inbound use**. These addresses now receive mail and may be published as contact addresses.

They still must not be presented as *sending* identities, and `questions@carup.dev` remains **not** the
canonical customer-support replacement — support stays `support@carup.dev` and `SUPPORT_URL`.

