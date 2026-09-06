# Garage & Mechanic Onboarding 1.0 — Canonical Plan

**Status:** canonical, planning frozen at GMO-0. **No runtime implementation is authorized by this
document.**
**Owns:** how a real automotive business becomes a CarUp organisation, and how real people become
its members.
**Does not own:** anything a member then does inside a service workflow — that is Service Network.
**Authority order:** Truth & Trust / security contracts → root `DESIGN.md` → this plan → component
decisions.

**Dependency chain this programme completes:**

```
O2 Identity / Registration → Garage & Mechanic Onboarding → Tenant / Context → Service Network
```

---

## 1. Why this programme exists

Service Network Foundation 1.0 is complete and certified at `ee45e556`. It proves that a governed
Garage membership can operate the whole service loop, and a governed Mechanic membership can perform
their permitted actions.

It rests on a membership **nothing in the product creates**. Verified from source (GMO-0 §1): every
production reference to `tenants` and `tenant_users` is a SELECT, and `onboarding_status` is written
once at registration and never advanced. A real garage applicant today gets a correct, honest, safe
account — and a dead end.

That is not a Service Network defect. It is a missing upstream programme, and this is it.

---

## 2. The binding authority rule

> **Creating an account records who a person says they are. Verification establishes supported
> identity or evidence. Business activation establishes an organisation. Membership establishes the
> person's relationship to that organisation. Domain services such as Service Network determine what
> that membership is allowed to do. None implies the next automatically.**

Five distinct facts, five distinct authorities, no automatic promotion between them.

### 2.1 Never creates professional authority

Absolutely, and each already guarded or to be guarded by a named test:

| input | why not |
|---|---|
| signup choice | a person choosing "Garage" is stating an intention |
| `business_type` | an application field; a claim is not a permission |
| registration profile | the record of a claim |
| OCR output | a machine's reading of a document a person supplied |
| identity verification alone | proves *who*, never *what they may operate* |
| QR scan | a scan is a read |
| Service Link | resolves what a link is; confers nothing |
| Garage Directory profile | a publication surface, not an authority |
| Seller authority | concerns one vehicle |
| vehicle ownership | concerns one vehicle |
| Dealer profile | a different domain's compliance record |
| free-text organisation claim | typing a company name is not founding one |

Existing guard: `backend/tests/service-network-authority-boundaries.test.js` (structural,
mutation-proven). GMO extends it rather than starting a second one.

### 2.2 The only thing that grants Service Network garage authority

A `tenant_users` row for a tenant of type `garage`, created by the canonical activation service
defined in §5, following an approved application.

---

## 3. Activation is not verification

Two different states, and collapsing them would be dishonest in one direction and useless in the
other.

| | **Workspace activated** | **Business verified** |
|---|---|---|
| means | CarUp has reasonable evidence this is a real automotive business and this person may act for it | CarUp has independently checked the business |
| enables | operating the Garage workspace, receiving service requests | a stronger public trust statement |
| public copy | *"CarUp has not independently verified this garage."* | the canonical verified statement |

> **Workspace activated ≠ Business verified.**

A Garage may operate while truthfully displaying that CarUp has verified nothing — which is exactly
what Garage Detail already says today, and must keep saying until a stronger review exists.

**Formal company registration is deliberately NOT assumed to be a precondition for workspace
activation.** Many legitimate Zimbabwean garages trade without it. What evidence is actually
required is a Product Owner decision (§12.1); the plan does not pre-empt it.

Candidate evidence, to be confirmed rather than assumed: authenticated contact; trading name;
physical location; phone; service categories; an owner/manager/authorised-representative
declaration; and — *where available* — business registration, proof of premises, licence, invoices
or stationery, photographs of premises/signage.

---

## 4. The Garage journey

```
Personal account
  → Garage application
  → business evidence
  → review
  → governed activation decision
  → Garage organisation/tenant created or activated
  → founding membership created
  → Garage operating context available
  → Service Network consumes that governed context
```

**The applicant never creates their own membership.** That is the whole point of the sequence.

| step | surface | authority |
|---|---|---|
| 1 Registration | existing `Register.tsx` | creates a safe base `owner` account; records intent; grants nothing |
| 2 Entry point | a clear next step after signup | *"Finish setting up your garage"* — never hidden in navigation |
| 3 Application | new applicant surface | organisation identity, location, contact, operator relationship, service categories, evidence |
| 4 Evidence / OCR | reuse `services/evidence/*` | candidates carry provenance; the user confirms or corrects; non-authoritative |
| 5 Submit | reuse `onboarding_status` | `requested → in_review` |
| 6 Review | reviewer surface | approve · reject with governed reason · request more information |
| 7 **Activation** | `BusinessActivationService` (§5) | creates/activates tenant + founding membership |
| 8 Portal handoff | existing `switch-role` + registry navigation | personal and Garage contexts both available |
| 9 Service Network | **#197, unchanged** | publish profile, receive requests, operate the queue |

Step 9 is where this programme stops.

### 4.1 Status vocabulary — reused, not invented

`user_registration_profiles.onboarding_status` already declares exactly the lifecycle needed:

```
not_required | requested | in_review | approved | rejected
```

Migration `20260829123000_user_registration_profiles.sql` already constrains it; nothing has ever
advanced it. GMO reuses this vocabulary. "Information required" maps to the existing Dealer
Compliance verb `request_more_info` acting on a requirement, keeping the applicant in `in_review`
with a named outstanding requirement, rather than adding a sixth status.

Reviewer verbs are reused verbatim from `dealerComplianceService`:
`approve_requirement · reject_requirement · request_more_info · restrict · suspend · reinstate ·
set_expiry`.

---

## 5. Canonical Business Activation

A single service owns the mutation. Working name `BusinessActivationService`, to be reconciled with
repository naming at GMO-4.

**Responsibilities**

1. validate that an **approved** application decision exists;
2. **idempotently** create or activate the organisation/tenant;
3. establish the founding membership with the initial authorised role;
4. record provenance — which application, which decision, which reviewer;
5. emit the audit event and the Communications domain event;
6. never accept tenant id, user id or role authority from browser input.

**Explicitly forbidden**

- a reviewer writing `tenants` / `tenant_users` from a generic admin UI;
- any endpoint accepting a client-supplied `tenant_id` or founding role;
- activation from a pending, rejected, or absent decision;
- two activations of one application producing two tenants or two memberships.

**Why a service and not an admin screen:** a human writing rows produces no provenance, no
idempotency and no reproducible audit. The reviewer decides; the service performs the deterministic
mutation.

### 5.1 Designed for reuse (§20 of the directive)

The sequence is domain-agnostic:

```
professional application → domain-specific evidence → governed decision
  → organisation/tenant → membership → operating context → domain capabilities
```

Only *evidence* and *domain capabilities* differ between Garage, Dealer, Importer, Exporter,
Insurer, Lender and logistics operators. GMO must therefore keep the activation core free of
garage-specific assumptions — tenant `type` and the founding role are parameters, not constants.

Dealer activation stays an open O2 gap; this plan does not close it, but must not make closing it
impossible.

---

## 6. Pending-state experience

A person mid-onboarding must never be dropped on the Owner Dashboard with no explanation. That was
the exact Service Network failure (a garage member landing on a "sell your car" screen), and it must
not be repeated one programme upstream.

A real status surface, e.g.:

```
Mbare Motors — Setup in progress
  Profile            Complete
  Business evidence  Received
  Review             In progress
  Garage access      Pending
```

Actions: continue setup · upload requested evidence · correct application · view status.

### 6.1 States that must never collapse into each other

`not submitted` · `missing evidence` · `under review` · `OCR unavailable` · `system error` ·
`rejected` · `approved`.

Especially:

> **OCR failure ≠ rejection** · **failed backend lookup ≠ no application** · **no evidence yet ≠
> fraudulent**

This is `DESIGN.md` §8 data-state design applied to a governance flow: loading, pending, unavailable
and error are different facts and must read differently.

---

## 7. Mechanic onboarding — its own journey

A `business_type: mechanic` claim is **not** a Garage membership and never becomes one.

**Primary flow (v1):**

```
Garage operator → Team / People → Invite mechanic
  → mechanic signs in or registers
  → invitation accepted
  → required identity checks
  → governed Garage membership created
  → Mechanic operating context appears
```

The plan must define, before implementation:

- invitation lifecycle and states;
- expiry;
- replay / idempotency (accepting twice creates one membership);
- acceptance by the intended person only;
- which authority creates the membership (the activation service, not the invitation surface);
- role assignment on acceptance;
- revocation and removal;
- stale-session behaviour after revocation;
- **historical Service Record attribution after membership ends.**

> **Ending a membership ends future authority. It never deletes history.** A completed service
> record keeps naming the mechanic who performed it. Anything else would falsify the vehicle's
> history to tidy an org chart.

---

## 8. Independent and mobile mechanics

Not all mechanics are garage employees, and pretending otherwise would encode a business model
nobody approved.

Recognised shapes: employed by a Garage · independent/mobile · self-owned workshop · specialist ·
body-shop technician · dealer technician.

**v1 scope, stated honestly:** *Mechanic attached to a governed Garage tenant only.*

Independent and mobile mechanics are a later feature requiring a Product Owner decision (§12.3).
They must **not** be faked by creating a single-person Garage tenant — that would put an
unapproved business model into production data and misrepresent the directory.

---

## 9. Role and operating-context model

Preserving the seven-layer lesson (`SN_0_CROSS_CUTTING_INTEGRATION.md` §SN-0.1).

One person may simultaneously be: base platform `owner` · manager at Garage A · mechanic at Garage B
· owner of their own vehicle · seller for one vehicle. These are not mutually exclusive.

| fact | authority |
|---|---|
| base authenticated identity | session → `users.id` |
| registration-profile claim | `user_registration_profiles` — never an authority |
| identity verification | O2 identity services |
| organisation | `tenants`, created only by activation |
| membership | `tenant_users`, created only by activation or accepted invitation |
| active operating context | `user_sessions.active_role` + `active_organization_id` via `switch-role` |
| domain capability | the domain service (e.g. Service Network) |

**Hard rule: no new role inference.** Desktop sidebar, compact bottom navigation, direct route
access and backend authorization must consume the *same* canonical context. Existing guards
(`web/src/lib/tenantRoleAccess.test.ts`, `web/src/hooks/garageSideRoutes.test.ts`) already fail on a
call site that forgets; GMO extends them rather than adding a parallel check.

---

## 10. Mobile is part of this feature from day one

Service Network treated mobile as responsive geometry and paid for it. Every GMO journey is
specified for mobile from the start: registration · application · document and photo upload · OCR
review and correction · status · request-for-more-information · approval handoff · portal/context
switching · mechanic invitation · mechanic acceptance.

Photo capture and document upload on a phone is the **primary** path for a Zimbabwean garage
applicant, not a fallback.

Use the canonical authenticated compact bottom navigation added during Service Network convergence,
and root `DESIGN.md` throughout. The design gate (`web/src/__tests__/designContract.test.ts`) must
be extended to cover new GMO surfaces — a surface it does not declare is an ungoverned surface.

---

## 11. OCR rules — unchanged

```
document → extraction candidate → provenance → user confirmation/correction
  → governed evidence/review → decision
```

OCR must never directly create: tenant · membership · Garage role · Mechanic role · Dealer role ·
Trust · approval · activation.

**Live OCR remains NOT ACTIVATED.** No provider credentials, no paid invocation, no neuron spend.
Future provider certification is a separate, separately-authorized programme.

Behaviour to specify for: success · unavailable · failure · low confidence · forged or
provider-invalid provenance · user correction · fully manual completion where allowed. An applicant
must always be able to finish without OCR.

---

## 12. Product Owner decisions still required

Only items that genuinely cannot be resolved from existing contracts.

1. **Minimum activation evidence for a Zimbabwe garage.** What must be present before a Garage may
   *operate a workspace*? The candidate list in §3 is a starting point, not a decision. Getting this
   wrong in either direction is costly: too strict excludes legitimate informal businesses, too
   loose lets anyone receive service requests.
2. **Who reviews.** Existing `admin` role, or a new operations/reviewer role? Dealer Compliance
   already has reviewer patterns; whether Garage applications share that queue is a decision.
3. **Independent / mobile mechanics.** In or out of v1? The plan currently says out, honestly.
4. **The founding role name.** The `tenant_users.role` value for the founding operator — Service
   Network's `GARAGE_ROLES` accepts `mechanic | dealer | admin` today, and a garage *manager* is
   arguably none of those. This may require a role vocabulary addition, which touches #197's
   accepted set and must be decided before GMO-4.
5. **Re-application after rejection.** Cooldown, appeal, or free re-submission.
6. **Multi-garage people.** Whether one person may found or join several Garage tenants in v1.

---

## 12A. FROZEN Product Owner decisions (PO-1 … PO-6)

Approved and binding. These close the questions §12 raised; §12 is retained as the record of what
was asked.

### PO-1 — Founding Garage operator role: tenant-scoped `admin`

The founding operator's `tenant_users.role` is **`admin`** — the existing tenant-scoped role.

- **Do not** introduce a new authorization role named `manager` merely because it is better UI
  wording. User-facing copy may say *Garage Manager*, *Garage Operator* or *Garage Administrator*
  as the surface warrants.
- **Do not** change the person's base/platform `users.role`. It stays the safe personal account.
  `active_tenant_role = admin` is authority **inside that Garage**, nothing wider.

This deliberately avoids reopening #197's certified `GARAGE_ROLES` acceptance
(`mechanic | dealer | admin`) to add a synonym — `admin` is already accepted.

> Consequence to hold carefully: a tenant-scoped `admin` must never be read as platform admin.
> `resolveEffectiveRole` already refuses to let a tenant role confer `admin` platform-wide, and
> `resolveOwnTenantRole` in feature governance already excludes `admin` from tenant-role widening.
> GMO must not weaken either.

### PO-2 — Minimum Garage activation evidence

**Workspace activation** requires all of:

1. an authenticated CarUp person;
2. governed O2 person-identity approval sufficient to establish who the applicant is — **no
   biometric requirement, no live-OCR requirement**;
3. Garage / trading name;
4. a real operating location/address;
5. contact details;
6. the applicant's declared relationship: owner · manager · authorised representative;
7. service categories;
8. applicant attestation;
9. **at least one credible business-presence evidence source** accepted by the governed
   evidence/reviewer workflow.

Eligible presence evidence, where genuinely available: company/business registration · local licence
· proof of premises · lease · utility/business-address evidence · invoice/receipt/business
stationery · premises or signage photographs · other reviewer-accepted evidence in the canonical
vocabulary.

**Formal company incorporation is NOT required** to let a legitimate Zimbabwe garage use Service
Network, unless a legal or existing CarUp contract explicitly requires it.

**Workspace activated ≠ Business verified.** An activated garage may still truthfully display
*"CarUp has not independently verified this garage."* Stronger evidence may later support a
`Business verified` state. That public truth rule may not be weakened.

### PO-3 — Reviewer authority

A Garage application is decided by an authorised **CarUp Operations / Compliance admin reviewer**
using the canonical governed review/decision machinery. No Garage-specific reviewer model.

Separation of duties is absolute:

| actor | does | never does |
|---|---|---|
| **Reviewer** | reviews evidence; requests information; approves; rejects; records decision + reason | types a tenant row or a membership row |
| **BusinessActivationService** | reacts to an eligible approved decision; creates/activates the tenant; creates the founding membership; records provenance, audit and events | decides the application |
| **Browser** | submits an application; supplies evidence | chooses tenant id, founding user or founding role |

### PO-4 — Independent / mobile mechanics: OUT of GMO 1.0

GMO 1.0 supports **a mechanic attached to a governed Garage organisation** only.

An independent or mobile mechanic must **not** be modelled as a fake one-person Garage to make the
feature work — that would put an unapproved business model into production data and misrepresent the
public directory. Recorded as a future product extension.

### PO-5 — Reapplication after rejection

`REJECTED` is a **terminal historical decision**. A rejected application is never rewritten back
into Draft.

- A rejected applicant may create a **new reapplication linked to the previous application and
  decision**, preserving the complete prior audit history.
- `INFORMATION_REQUIRED` is different: the **same** application stays active, the applicant supplies
  what was requested, and review resumes.

The distinction must survive into the data model, not just the copy.

### PO-6 — Multi-Garage people

A person may legitimately belong to **several** Garage tenants — mechanic at Garage A and Garage B;
owner of A who also works at B; a garage operator who also owns personal vehicles.

Rules:

- memberships are **not** globally exclusive;
- authorization is **tenant-scoped**;
- exactly one active operating context at a time;
- context switching uses the existing governed mechanism (`POST /api/auth/switch-role`);
- **Garage A authority never leaks into Garage B**;
- each membership is revocable independently;
- historical service attribution survives revocation.

`tenant_users` must not be artificially constrained to one Garage per person. Its existing
constraint is `UNIQUE(tenant_id, user_id)` — one membership **per tenant per person**, which permits
many tenants per person. That is compatible with PO-6; no schema conflict exists.

---

## 13. Phased programme

Each phase is independently UAT'd. **No phase may be declared complete because a backend API
exists.**

| phase | delivers | UAT boundary |
|---|---|---|
| **GMO-0** | authority & current-state reconciliation (read-only) | ✅ complete — `GMO_0_DISCOVERY_RECEIPT.md` |
| **GMO-1** | Garage Application: create, resume, submit | applicant can submit; nothing is activated |
| **GMO-2** | Business evidence + OCR assistance | evidence attaches with provenance; still nothing activated |
| **GMO-3** | Review & decision | reviewer can approve, reject, request info; still nothing activated |
| **GMO-4** | **Canonical Business Activation** | approved application idempotently creates tenant + founding membership; no manual SQL; heavily mutation-tested |
| **GMO-5** | Portal / context handoff | approved applicant gains Garage context on desktop and mobile; pending does not; revoked loses it |
| **GMO-6** | Mechanic invitation & membership | operator invites, mechanic accepts, governed membership created |
| **GMO-7** | Membership revocation & lifecycle | future authority ends; historical attribution survives |
| **GMO-8** | Full physical Golden Journey | register → apply → evidence → approve → activate → Garage context → invite mechanic → accept → Service Network request → work → completion, desktop and mobile |

**GMO-8 rule:** no direct SQL fixture may stand in for any core onboarding step in the final
certification. The whole point of this programme is that the journey exists in the product.

---

## 14. Definition of Done, per phase

Every phase requires: a canonical plan section · the owner/user journey · an authority matrix ·
`DESIGN.md` compliance · desktop/tablet/mobile · focused tests · negative and security tests ·
**mutation proof for every consequential authority** · physical browser UAT where applicable · a
durable receipt · and an explicit statement of remaining gaps.

---

## 15. Negative tests the programme must prove

Planned now so they cannot be retrofitted as an afterthought:

1. `business_type=garage` cannot create Garage access.
2. `business_type=mechanic` cannot create Mechanic access.
3. OCR candidate fields cannot create a tenant or a membership.
4. Identity approval alone cannot create a tenant.
5. A forged application approval cannot create a tenant.
6. A browser-supplied `tenant_id` cannot select an arbitrary tenant.
7. A browser-supplied founding role cannot select an arbitrary role.
8. Duplicate activation creates exactly one tenant and one membership.
9. A **rejected** application cannot activate.
10. A **pending** application cannot activate.
11. A revoked mechanic cannot begin new Service Network operations.
12. A former mechanic's historical Service Records remain attributable.
13. Garage A cannot invite a mechanic into Garage B.
14. An ordinary owner cannot reach a reviewer action.
15. A reviewer cannot silently edit an application and approve their own fabricated evidence, unless
    an explicit governed contract permits it.
16. **A failed database operation cannot become a confident "approved" state.**

Item 16 is not hypothetical. This exact class of bug shipped during Service Network: a query naming
a column that did not exist returned an error, a bare `catch` swallowed it, and a broken read became
a confident "this person belongs to no tenant". Activation is far more consequential than a
membership read.

---

## 16. Handoff contract with Service Network

| Garage & Mechanic Onboarding owns | Service Network owns |
|---|---|
| the application | garage publication / service profile |
| business identity & evidence | Service Requests, Service Cases |
| review and decision | the queue |
| **activation** | Work Orders |
| organisation membership | mechanic assignment |
| relationship lifecycle (invite, accept, revoke) | Service Records |
| | Evidence linked to a service case |
| | Service History, Passport projection |
| | Service Link / QR actions |
| | service-domain capability |

Neither side duplicates the other. Service Network reads membership; it never writes it. This
programme writes membership; it never decides what a member may do inside a service workflow.
