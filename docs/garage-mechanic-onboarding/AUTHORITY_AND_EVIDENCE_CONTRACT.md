# Garage & Mechanic Onboarding — Authority & Evidence Contract

**Binding.** Extracted from the canonical plan so it can be cited on its own in reviews and tests.

---

## 1. The five authorities

| # | authority | establishes | owned by | may NOT establish |
|---|---|---|---|---|
| 1 | **Account** | who a person says they are | Auth / Registration | anything else |
| 2 | **Verification** | supported identity or evidence | O2 identity services | an organisation, a membership, a capability |
| 3 | **Business activation** | an organisation exists on CarUp | `BusinessActivationService` (GMO-4) | what its members may do |
| 4 | **Membership** | a person's relationship to that organisation | activation (founding) / accepted invitation | the domain capability set |
| 5 | **Domain capability** | what a member may do in a workflow | the domain service, e.g. Service Network | identity, organisation or membership |

**No authority implies the next.** Each transition is a governed decision with its own evidence,
its own actor and its own audit record.

---

## 2. Inputs that are evidence, never authority

| input | what it is | what it is not |
|---|---|---|
| signup choice | a stated intention | a permission |
| `business_type` | an application field | a role |
| registration profile | the record of a claim | a grant |
| OCR extraction | a machine's reading of a supplied document | a fact CarUp asserts |
| identity verification | evidence about a *person* | evidence about a *business* |
| QR / Service Link | a resolvable reference | a capability |
| Garage Directory profile | a publication surface | an authority |
| Seller authority | authority over **one vehicle** | authority over an organisation |
| vehicle ownership | a relationship to **one vehicle** | a professional relationship |
| Dealer profile | another domain's compliance record | a garage membership |
| typed organisation name | a claim | a founded organisation |

Guarded structurally by `backend/tests/service-network-authority-boundaries.test.js`, which asks
whether any authorization path *consults* these at all — a stub answers whatever it is asked, so the
test reads source rather than mocking behaviour.

---

## 3. Activation invariants

The activation service is the only writer of `tenants` and founding `tenant_users` rows.

| # | invariant | failure it prevents |
|---|---|---|
| A1 | activates only from an **approved** decision | pending or rejected applications becoming businesses |
| A2 | **idempotent** — one application yields one tenant and one membership | duplicate organisations from a retried request |
| A3 | tenant id, user id and role are **never** taken from browser input | choosing an arbitrary tenant or founding role |
| A4 | records provenance: application, decision, reviewer, timestamp | an organisation nobody can explain |
| A5 | emits audit **and** a Communications domain event | a silent grant |
| A6 | a failed write **fails loudly** and activates nothing | a broken operation reported as approval |
| A7 | `type` and founding role are **parameters** | a garage-shaped activation that Dealer cannot reuse |

A6 is drawn from a real defect in this repository: a query naming a non-existent column returned an
error, a bare `catch` swallowed it, and a broken read became a confident answer that shipped.

---

## 4. Evidence model

### 4.1 Two thresholds, never conflated

| | workspace activation | business verification |
|---|---|---|
| question | is this a real automotive business, and may this person act for it? | has CarUp independently checked it? |
| grants | operating the workspace | a stronger public trust statement |
| public copy | *"CarUp has not independently verified this garage."* | the canonical verified statement |

A Garage operating on CarUp while unverified is the **normal** state, and the product must say so
plainly rather than implying endorsement.

### 4.2 Evidence states — reused from Dealer Compliance

```
verified | present | pending | rejected | not_applicable
```

### 4.3 Application lifecycle — reused from the registration profile

```
not_required | requested | in_review | approved | rejected
```

Already declared and constrained by `20260829123000_user_registration_profiles.sql`, and never yet
advanced past `requested`. "Information required" is `request_more_info` acting on a named
requirement while the application remains `in_review` — not a sixth status.

### 4.4 Reviewer verbs — reused

```
approve_requirement | reject_requirement | request_more_info
restrict | suspend | reinstate | set_expiry
```

### 4.5 Privacy

Evidence used for activation is **not** public because it was used for activation. Business
documents, premises photographs and personal identity evidence stay behind object-level
authorization. What the directory shows is a published profile, not the file that justified it.

---

## 5. Membership lifecycle

| event | who may cause it | creates | ends |
|---|---|---|---|
| founding membership | activation, after approval | tenant + first membership | — |
| invitation | an authorised member of **that** tenant | an invitation, not a membership | expiry / revocation |
| acceptance | the invited person only | the membership | — |
| revocation / removal | an authorised member of that tenant | — | future authority only |

> **Ending a membership ends future authority. It never deletes history.**

A completed service record keeps naming the mechanic who performed it. Rewriting history to tidy an
org chart would falsify the vehicle's story — the one thing CarUp exists to keep honest.

Stale sessions must lose authority on the next request; the backend re-verifies membership rather
than trusting a session issued earlier.

---

## 6. Context resolution — no new inference

The operating context already exists and is governed:

```
POST /api/auth/switch-role
  → verifies tenant_users membership ("you do not belong to this organization")
  → canAssume = role === users.role OR (verified tenant role AND role !== 'admin')
  → issues a session carrying active_role + active_organization_id
  → audit-logged
```

GMO produces the membership this endpoint verifies. It does **not** introduce a parallel context
model, and it adds **no** new role inference. Desktop sidebar, compact bottom navigation, direct
route access and backend authorization consume the same canonical context — the invariant Service
Network violated seven times before it held.
