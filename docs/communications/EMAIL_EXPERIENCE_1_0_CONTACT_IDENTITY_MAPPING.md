# CarUp contact identity mapping — canonical

**Status:** owner-approved. Frozen 2026-08-18.
**Programme state:** `EMAIL_EXPERIENCE_X0_COMPLETE_WRITE_LANE_BLOCKED` — specification only. No Cloudflare
rules created, no source mutated.

This is the single source of truth for which address CarUp uses for which purpose, in email footers and in
product copy. Plan §30 requires purpose-based mapping: **do not display all aliases in all emails.**

---

## 1. Functional aliases — certified

All seven were physically certified in Email 1.0 E7 (real send, `delivered`, forwarding to the owner-verified
destination). They are the canonical functional contacts and are **not** replaced by any staff alias.

| Alias | Purpose | Footer families that may show it |
|---|---|---|
| `support@carup.dev` | general and customer help | transactional/service, marketing |
| `security@carup.dev` | suspicious account or security issue | **security only** |
| `privacy@carup.dev` | privacy requests | marketing (privacy context), legal pages |
| `legal@carup.dev` | legal / terms | marketing (legal context), legal pages |
| `dpo@carup.dev` | data protection / DPO | legal pages; email only where a data-protection contact is required |
| `info@carup.dev` | general institutional contact | leadership/lifecycle Reply-To; general |
| `press@carup.dev` | editorial / media | press surfaces; not routine customer email |

## 2. Staff / human aliases — approved and inbound-certified

Human correspondence addresses. **Not** automated transport identities.

| Alias | Person / owner | Public role | Purpose | Leadership-email eligible |
|---|---|---|---|---|
| `kudzie@carup.dev` | S.K Musarurwa | Co-Founder & Head of Development | personal leadership / business correspondence | **YES** (separate approval to use) |
| `king@carup.dev` | Kingston Musarurwa | Founder / COO | personal leadership / business correspondence | no |
| `questions@carup.dev` | CarUp Team | — | shared general questions / business correspondence | no |

Current forward destination for all three: `buynsellpvtltd@gmail.com`.

> **Forwarding destinations are operational configuration.** They may change at any time **without** changing
> the public `@carup.dev` alias. No template, config, test or document may hardcode a forward destination —
> the public alias is the stable contract, the destination is not.

**`INBOUND_ROUTING_CERTIFIED=YES`** — owner physical evidence, 2026-08-18. All three aliases deliver to
`buynsellpvtltd@gmail.com`, and a negative control to `no-such-address-81826@carup.dev` was rejected,
re-proving the catch-all remains off. They may now be published as **contact** addresses.

**`OUTBOUND_SENDING_CONFIGURED=NO`** — these aliases cannot send. Never present them as `From` identities.

## 3. Legacy `@carup.co.zw` → `@carup.dev` mapping

`MIGRATE_SHIPPED_CARUP_CO_ZW_CONTACTS = YES` — **deliberate functional mapping, never a blind global
replace.** 18 occurrences across 9 addresses on `main`.

### 3.1 Functional — 1:1, sequence the regulated four first

| Legacy | Count | → | Sequence |
|---|---:|---|---|
| `privacy@carup.co.zw` | 2 | `privacy@carup.dev` | **1st — regulated** |
| `dpo@carup.co.zw` | 1 | `dpo@carup.dev` | **1st — regulated** |
| `legal@carup.co.zw` | 6 | `legal@carup.dev` | **1st — regulated** |
| `support@carup.co.zw` | 3 | `support@carup.dev` | 2nd |
| `info@carup.co.zw` | 2 | `info@carup.dev` | 2nd |
| `press@carup.co.zw` | 1 | `press@carup.dev` | 2nd |

(`security@` has no legacy `@carup.co.zw` occurrence — it is new in the email footers.)

### 3.2 Personal legacy addresses — owner-resolved

| Legacy | → | Note |
|---|---|---|
| `rudo.mutasa@carup.co.zw` | `press@carup.dev` | address maps to the functional press alias |
| `chipo.sibanda@carup.co.zw` | `press@carup.dev` | address maps to the functional press alias |
| `tendai@carup.co.zw` | **remove the fabricated persona**; use `info@carup.dev` where a general Careers contact is needed | tied to the forbidden demo identity |

> **The address mapping does not validate the person.** Mapping `rudo.mutasa@` and `chipo.sibanda@` onto
> `press@carup.dev` gives those contact blocks a working address, but **"Rudo Mutasa" and "Chipo Sibanda"
> remain unverified named individuals** presented on a live page with a "Direct / Online" status indicator,
> and one of their listed phone numbers is demo seed data. Replacing the address does not make the named
> presentation true.
>
> Whether those people are shown at all is part of `WEBSITE_BRAND_IDENTITY_RECONCILIATION=REQUIRED`, not
> something this mapping settles. **Email must not reference either individual by name.**

## 4. Purpose → contact resolution used by the footer system

| Purpose | Contact |
|---|---|
| General / customer help | `support@carup.dev` |
| Suspicious account or security issue | `security@carup.dev` |
| Privacy request | `privacy@carup.dev` |
| Data protection / DPO | `dpo@carup.dev` |
| Legal / terms | `legal@carup.dev` |
| General institutional contact | `info@carup.dev` |
| Editorial / media | `press@carup.dev` |
| Leadership reply path | `info@carup.dev` (frozen; `kudzie@` only on separate approval) |
| Shared general questions | `questions@carup.dev` — **not** the support replacement |

## 5. Binding rules

1. Staff aliases never become automated `From` addresses.
2. Staff aliases never replace the seven functional aliases.
3. `LEADERSHIP_REPLY_TO` remains `info@carup.dev`. `kudzie@` is eligible but requires separate approval.
4. `questions@` is not the canonical customer-support replacement; support remains `support@carup.dev` and
   `SUPPORT_URL`.
5. No additional personal `@carup.dev` addresses may be fabricated. Sections 1–2 are exhaustive.
6. Forward destinations are never hardcoded anywhere.
7. Email must not name `Rudo Mutasa`, `Chipo Sibanda`, or any `About.tsx` persona.
8. A footer shows only the contacts relevant to its purpose — never the full list.

## 6. Anti-phishing dependency

Plan §17 relies on a recipient being able to cross-check an email against the website. Until the §3 migration
lands, the site still advertises `@carup.co.zw` for the same purposes email will advertise as `@carup.dev`.
That divergence is an anti-phishing weakness in both directions, and it is why the migration is sequenced
**with** the footer work rather than after it.
