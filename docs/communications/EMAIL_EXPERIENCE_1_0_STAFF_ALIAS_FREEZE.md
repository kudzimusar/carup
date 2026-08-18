# CarUp human/staff email aliases — owner freeze

**Status:** OWNER-APPROVED AND AUTHORITATIVE. Frozen 2026-08-18.
**Programme state:** `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED` — documentation only. No infrastructure
was created, no source mutated, no PR opened.

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

Both are certified-deliverable in principle, but note the difference in evidence: `info@` was **physically
certified** in Email 1.0 E7 (real send, `delivered`, forwarded to the owner-verified destination), whereas the
three staff aliases have **no routing rules yet** — see below.

---

## `STAFF_ALIAS_ROUTING_PENDING`

**None of `kudzie@carup.dev`, `king@carup.dev` or `questions@carup.dev` has a Cloudflare Email Routing rule.**

Evidence and its limits, stated precisely:

- The last **direct** observation of the zone's routing rules was the Email 1.0 E8 cleanup on 2026-08-17. At
  that point the rule set was exactly **seven** aliases — `security@`, `privacy@`, `legal@`, `dpo@`,
  `support@`, `info@`, `press@` — plus one **disabled** catch-all. The temporary
  `routing-certification@carup.dev` rule had been retired. The three staff aliases were not present.
- I **cannot re-verify live now**: the Cloudflare credential file `.env.local` was deleted during that same E8
  cleanup at owner instruction, and no Cloudflare token is available in this environment.
- The three aliases appear **nowhere** in the repository — no source, doc or config references them.

So this is a strong inference from a dated direct observation, not a live read. If anything changed the zone
after 2026-08-17, that would not be visible to me.

**No routing rules were created.** Creating them is infrastructure mutation, which the freeze forbids. Three
rules are required before any of these addresses can receive mail:

```text
kudzie@carup.dev     -> buynsellpvtltd@gmail.com
king@carup.dev       -> buynsellpvtltd@gmail.com
questions@carup.dev  -> buynsellpvtltd@gmail.com
```

Until they exist, mail to these addresses will be rejected — the zone has **no catch-all**, which Email 1.0
proved positively with a bounced negative control. That is the correct posture, but it does mean these
addresses are advertised-but-dead until the rules are created.

**Do not publish these addresses in any customer-facing surface until routing is created and certified.**

### Prerequisites when the lane opens

1. Re-establish Cloudflare credentials (they were deliberately removed).
2. Create the three routing rules.
3. Certify by real send, as Email 1.0 did — `delivered` proves the receiving MX accepted; port 25 is blocked
   from the build host, so an SMTP RCPT probe is not available.
4. Keep the no-catch-all invariant intact, and re-prove it with a negative control.
