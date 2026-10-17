# Trade OS T12 — Attributed customs coordination & Zimbabwe destination · Receipt

**Status: `T12-USABLE` — OWNER ACCEPTED / FROZEN.**

| | SHA | why |
|---|---|---|
| **T12 runtime freeze** | **`4d880f59`** | the last runtime-affecting commit — see below |
| **T12 certification head** | `4d880f59` (runtime-identical at `177371c2`) | deployed journeys, responsive and mutation evidence |
| **T12 owner-acceptance docs** | this commit | documentation only |

**Why `4d880f59` and not `177371c2`.** `177371c2` touches one file — this receipt — so it is
**genuinely documentation-only** relative to the runtime tree: `git diff --name-only 4d880f59
177371c2 -- . ':(exclude)docs' ':(exclude)*.md'` returns **zero** paths.

`4d880f59` looks like a documentation commit and **is not.** It also regenerates
`shared/navigation/feature-manifest.json`, and that file is read **from disk at runtime** by two
backend services — `featureGovernanceService.js:21` and `navigationAnalyticsService.js:22`. The web
side only mentions it in a comment. So the manifest is runtime-affecting, and the freeze SHA is
`4d880f59`.

**An honest consequence, recorded rather than glossed:** the deployed journeys and responsive
certification were first run against `c8e416f1`, and `255d9306` changed runtime afterwards. That
certification was therefore **re-run at the final runtime tree** — see §5.

Predecessor: `T11-USABLE`, OWNER ACCEPTED / FROZEN at `9ce19115`.
Plan: `docs/trade-os/T12_CUSTOMS_ZIMBABWE_DESTINATION_IMPLEMENTATION_PLAN.md`.
Source register: `docs/trade-os/T12_ZIMBABWE_CUSTOMS_AUTHORITY_SOURCE_REGISTER.md`.

`main` unmodified. **No production writes.** PR #207 Draft. **T13 not started.**

---

## The nine statements the owner required this receipt to make

1. **There is NO CarUp duty or tax calculator.** Not disabled, not behind a flag — it does not
   exist. `grep` the two service files for a percentage, a formula or a rate and the only numbers
   are string-length limits. This is an explicit MVP scope decision, not a gap.
2. **The model is licensed-agent coordination.** A participant appoints a clearing agent for one
   case; the agent performs the regulated act; CarUp records who said what, when, and on what
   evidence.
3. **ZIMRA integration is NOT active.** There is none.
4. **`ZIMRA_ADAPTER` / `ZIMRA_API_KEY` remain unverified scaffolding, and are not enabled.** Nothing
   in this phase calls them, and nothing claims a ZIMRA API exists.
5. **Assessment and evidence are ingested only.** Every amount is transcribed from a source. None is
   computed, and none is defaulted.
6. **A legal-source register exists** — provenance, not law, and carrying no rate at all.
7. **Customs FX is external-source only**, recorded with its source and its effective period, and
   never inferred from T6 reference FX, market FX, today's rate or a previous declaration.
8. **Production blast radius: NO MEASURED PRODUCTION BLAST RADIUS.** See §1.
9. **Government authority tables are not CarUp workflow stores.** T12 writes to none of them, and a
   test proves it.

> **CarUp coordinates customs. CarUp is not ZIMRA, and CarUp is not a licensed clearing agent.**

---

## 1. Production blast radius — READ ONLY, aggregates only

The owner authorized one bounded read-only investigation. It found nothing.

**Environment identity, captured before access and proved by contrast:**

| | production | staging |
|---|---|---|
| connected as | **`supabase_read_only_user`** | `postgres` |
| server address | `2406:da1a:314:7101:…` | `2406:da1c:61c:d601:…` |
| user tables | 223 | 328 |
| `users` rows | 29 | 229 |

The production connection is a **structurally read-only role**: mutation is impossible at the
credential level, not merely avoided. No credential or configuration was altered.

**Synthetic signatures derived verbatim from the removed writer** (`documentIntelligenceService.js`
at `df627937^`), not guessed. `customs_ref_number` was `'CUS_' + 8 uppercase hex` on every row and
`exchange_rate_used` was `13.5` unconditionally; `logbook_serial_number` was `'LB_' + 10 hex`
unconditionally.

| table | predicate | count |
|---|---|---|
| `zimra_declarations` | **TOTAL ROWS (denominator)** | **0** |
| `zimra_declarations` | `customs_ref_number ~ '^CUS_[0-9A-F]{8}$'` | 0 |
| `zimra_declarations` | `exchange_rate_used = 13.5` | 0 |
| `zimra_declarations` | `duty_calculated_zig = 50000` | 0 |
| `zimra_declarations` | `duty_paid_zig = 50000` | 0 |
| `zimra_declarations` | ANY synthetic signature | 0 |
| `cvr_ownership_records` | **TOTAL ROWS (denominator)** | **0** |
| `cvr_ownership_records` | `logbook_serial_number ~ '^LB_[0-9A-F]{10}$'` | 0 |
| `cvr_ownership_records` | `registration_number ~ '^REG_[0-9A-F]{8}$'` | 0 |
| `cvr_ownership_records` | `owner_id_number = '29-198427-G-45'` | 0 |
| `cvr_ownership_records` | ANY synthetic signature | 0 |

**Writes: none. Row data read: none** — no `SELECT *`, no names, no national IDs, no addresses, no
document bytes. Aggregates only.

**The denominator is the strongest part of this result.** Both tables are entirely empty in
production, so there is no interpretation to argue about: the fabricated path never ran there.

**`cid_clearance_records`, `vid_inspections`, `zinara_licensing_records` — CODE AUDIT ONLY, as
authorized.** No writer exists in the current tree, and `git log --all -S"from('<table>').insert"`
returns nothing across the entire history. The fabricated writer never touched them, so the
conditional authorization to count them **was not exercised**.

> **NO MEASURED PRODUCTION BLAST RADIUS.**

---

## 2. The certification gate that had been dead for months

`Diaspora Deployed Staging UAT` was pinned to
`github.head_ref == 'claude/diaspora-phases-8-10-production-program'` with hardcoded
`STAGING_WEB_URL`/`STAGING_API_URL` belonging to a **different Vercel project**. That branch is long
dead, so the job's `if:` was false on every pull request and the workflow reported `skipped` — **a
green tick, for months, for a gate that had certified nothing.**

Replacing one hardcoded branch with another would reproduce the defect on a slower clock. The pair is
now resolved from the governed manifests the rest of Trade OS already uses, and **a branch with no
governed pair FAILS; it does not skip.**

The logic lives in `scripts/ci/resolve-governed-preview-pair.mjs`, not in YAML, **because a refusal
nobody can test is not a gate.** Seven named refusals:

| refusal | what it stops |
|---|---|
| `UNGOVERNED_BRANCH` | the old failure mode — a branch nobody paired reporting success |
| `PRODUCTION_ORIGIN` | certifying against production |
| `PRODUCTION_ORIGIN` (stable alias) | certifying against `carup-staging.vercel.app`, which serves whatever was last promoted and proves nothing about a candidate |
| `FRONTEND_STALE` / `BACKEND_STALE` | a deployment quietly serving an older commit |
| `UNPAIRED` | the Issue #164 defect — a preview falling back to the shared backend, so every backend-dependent step measures `main` |
| `PAIR_MISMATCH` | a frontend talking to a backend that happens to serve the right commit but is another branch's |
| `WRONG_STAGING_PROJECT` | the wrong database |

**20 tests with positive controls on both sides, and 8 mutations of the refusals, all red.**

### Turning it on revealed what it had been hiding

The repair is proved end-to-end. On the candidate head the resolver step SUCCEEDED, pinning both
deployments to the exact SHA:

```
{"ok":true,
 "frontend":"https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app",
 "backend":"https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app",
 "sha":"4d880f59…","deployment_id":"dpl_B7RAkDft9CBrgxbhoRFbzJjeky3F"}
```

The job then ran real Chromium against that pairing for the first time in months — and **it does not
pass.** It reached roughly 197 of ~200 tests across three device projects before hitting the job's
35-minute timeout, with genuine failures in:

| spec | lane |
|---|---|
| `33-diaspora-staging-browser-parts` | parts / seller |
| `34-diaspora-staging-browser-security` | security |
| `38-seller-staging-browser-golden` | seller |
| `45-trade-os-container-demo-staging` | T5 |
| `46-trade-os-rfq2-staging` | T2 |

**None is in T11 or T12.** This is the accumulated, previously-invisible state of a gate that has not
executed since the branch it was pinned to died — precisely the hazard the programme already
recorded: *a branch can be green for weeks while a gate it never triggered is red, so establish the
baseline before assuming a newly-red gate is yours.* That baseline is now established.

**It has deliberately NOT been made green.** Raising the timeout would paper over it, and narrowing
`testMatch` would change what the gate certifies — a decision that is the owner's, not this phase's.
**Owner decision required** on how the backlog is scheduled.

**T12's staging certification therefore rests on the three harnesses below**, each run against the
same proven pairing — not on this gate.

The workflow header still names the dead branch and the wrong project *in prose*, because why it was
rewritten is the most useful thing in the file. The test therefore scans executable YAML with comment
lines stripped: **an assertion a comment can satisfy is not an assertion.**

---

## 3. The truth model

`assertion_class` is the whole phase, and there are exactly two values:

- **`CARUP_OBSERVED`** — an authorized person physically saw it. CarUp may originate this, and only
  ever for a physical fact: goods arrived somewhere, were collected, were delivered.
- **`ATTRIBUTED`** — somebody told us. Everything a customs authority does reaches CarUp this way,
  carrying who said it, what they are to this case, when, and on what evidence.

There is no third class, and in particular **none that means "true".**

Every step stays separate, because the moment a single `cleared` boolean exists, all of these start
being written to it:

> DOCUMENT PRESENT ≠ LODGEMENT REPORTED ≠ ASSESSMENT EVIDENCE ≠ PAYMENT EVIDENCE ≠ RELEASE EVIDENCE
> ≠ PORT RELEASE ≠ COLLECTION ≠ DELIVERY ≠ VEHICLE REGISTRATION

`VEHICLE_REGISTRATION` is **deliberately absent from the vocabulary.** Registration is the CVR's act;
a type for it here is how a phase starts writing another authority's records.

### The wording rule

The same **USD 1,420.50** produces two different sentences:

| source | headline | detail |
|---|---|---|
| an authority document, attached | **Assessment amount** | "Taken from an assessment document attached to this case. CarUp did not calculate it." |
| an agent typing it | **Agent-reported amount** | "…this is their figure, not the authority's." |

Two headings, not one heading with two badges — **a reader skimming for a number will not read a
badge.** Proven on the deployed product against the same figure on two cases.

Payment evidence never reads as settlement: "Payment evidence received … that is evidence of a
payment; it is not the authority confirming the account is settled." The phrase **"duty paid" appears
nowhere**, and a test asserts it.

### The appointment is not a licence

ZIMRA licenses clearing agents and the licence expires on 31 December of the year of issue (source
register §7). CarUp cannot verify either. The column is therefore named
**`licence_reference_claimed`** — a column called `licence_number` would, within one release, be
rendered somewhere as though CarUp had checked it — and every surface says
*"CarUp has not verified this licence reference with the authority."*

---

## 4. What the database enforces, not just the service

Three tables, added only after reconfirming nothing already owned this:
`diaspora_safetrade_delivery_confirmations` is escrow-release machinery keyed on a SafeTrade
transaction and gated by a dispute window, so it cannot record a physical handoff for cargo with no
escrow — and **a delivery observation here never releases money.**

| constraint | what it makes impossible |
|---|---|
| `customs_event_authority_claim_needs_evidence` | a claim on the authority's name with nothing behind it |
| `customs_event_amount_placement` | an amount where an amount cannot mean anything, or without a currency |
| `customs_event_rate_has_provenance` | **a rate with no source or no effective date — this is the removed `13.5`** |
| `customs_event_observation_is_carups` | a CarUp observation borrowing an authority's name, or the reverse |
| `uq_customs_case_live_subject` (partial) | two live cases for one consignment |
| `uq_customs_case_one_active_agent` (partial) | two people each believing they are clearing it |
| append-only guards | rewriting or deleting what was asserted, by whom, on what evidence, and when |

**PGlite gate: 34/34**, with positive controls — a partial index frees its slot again once the case
is abandoned, and the correction path (supersede and attribute) still works.

---

## 5. Certification

Against the deployed staging product at a proven FE/BE pairing.

| gate | result |
|---|---|
| staging journeys A–I (`t12-customs-journeys.mjs`) | **36 / 36** |
| responsive, 7 widths × 2 surfaces (`t12-responsive-certification.mjs`) | **14 / 14**, and the gate was proved to FAIL on a case that does not exist |
| mutation matrix (`t12-mutation-matrix.sh`) | **30 named mutations, 30 red** |
| `trade_os_t12_customs_check` PGlite gate | 34 / 34 |
| T12 service tests | 46 |
| T12 registry-authority tests | 8 |
| CI preview-pair resolver tests | 20 |
| T12 web tests | 57 |
| backend · web · gates · `tsc -b` · lint | §7 |

### The security matrix — positive controls on both sides

| actor / attempt | result |
|---|---|
| anonymous read / read / write | 401 · 401 · 403 |
| **operator reads the case** | **200 — positive control** |
| **appointed agent reads the case** | **200 — positive control** |
| **each participant reads their OWN case** | **200 — positive control** |
| **the importer supplies their own payment receipt** | **201 — positive control** |
| customer self-clears (lodgement / assessment / release / inspection) | 403 ×4 |
| co-loader reads another participant's case | 403 |
| co-loader reads the other case's workspace, amounts, documents | 403 |
| foreign clearing agent reads / writes a case they were not appointed to | 403 · 403 |
| anyone self-appoints as clearing agent | 403 |
| foreign tenant, own header / **forged `x-tenant-id`** | 403 · 403 |
| forged case id | 404 (authenticated), 401 (anonymous) |
| forged customs amount (no document, `AUTHORITY_DOCUMENT`) | 400 |
| forged customs rate (no source / no effective date) | 400 · 400 |
| a future event | 400 |
| a second live case for one consignment | 400 |

The participant projection was asserted field-by-field to carry no other participant's booking, no
operator identity, no agent id, no tenant id and no document id.

---

## 6. What each kind of looking found

Three defects, each caught by a different method, none visible in review.

**The mutation matrix found one that SURVIVED.** Adding `DOCUMENT_PROVIDED` to the RELEASE step's
satisfying list broke nothing — §I's own rule, *uploading "release.pdf" does not release goods*, was
unguarded. Fixing it exposed a second: the checklist decided EVIDENCED from whether the **source** was
the authority, so the documents step itself read *"Reported, no document"* for a document that had
been supplied and attached.

**Looking at the deployed page at 393px** found the third: the participant was shown *"Customs
exchange rate 26.4312 (USD/ZWG)"* and nothing about where it came from or when it applies, while the
operator saw both. **A rate without its provenance is precisely what this phase removed.**

**A governed staging fixture found a fourth.** `users.id` and `organizations.id` are **TEXT** in this
schema, and `agent_user_id` was declared `uuid` — making the entire appointment path unusable against
real identities. Nothing caught it because the in-memory test client has no column types: `'user-agent'`
inserted happily into a column Postgres would have rejected. The PGlite gate now asserts the column
type directly.

Two harness defects are recorded too, both of the same family the programme keeps meeting: a bare
substring ban on `vin` matched **"leaving"** and **"moving"** (the shape of `eta` matching `metadata`
in T10), and a Vercel cold start dropped a connection.

---

## 7. Numbers

Recorded at freeze; the PR carries the exact SHA and CI run.

| suite | result |
|---|---|
| backend | see PR |
| web | see PR |
| migration gates | 8 / 8 exit 0 |
| `tsc -b` | clean |
| lint baseline | NET_NEW_ERRORS=0 |

---

## 8. Accepted limitations, and what is genuinely open

**The owner has accepted the T12 MVP scope.** Everything in the first group below is an accepted
boundary of that scope, recorded so it is never mistaken for an outstanding defect:

- CarUp coordinates customs; **CarUp is not ZIMRA**; CarUp is **not a licensed clearing agent**;
- **no CarUp duty/tax calculator**, and **no VAT/surtax calculator** — amounts are transcribed from
  evidence, never computed;
- **customs FX is external-source only**, with its own effective period;
- the **ZIMRA adapter is unverified and disabled**, and nothing calls it;
- **no government-table writes**;
- **production blast radius measured NIL**;
- the **legal-source questions are retained** in the plan §4;
- the **vehicle age policy remains `NEEDS_LEGAL_CONFIRMATION`**, with **no automatic legal rejection
  engine** — CarUp declares no vehicle un-importable.

Genuinely open:
- **The duty-and-tax calculation boundary stays out of scope by owner ruling**, not by blockage. Nine
  questions remain in the T12 plan §4 for whenever it is opened; **nothing has been invented against
  them**, and the source register carries no rate to invent from.
- **The vehicle age restriction is `NEEDS_LEGAL_CONFIRMATION`** and is deliberately NOT an automatic
  rejection engine (§N). The instrument has visibly moved — a transitional extension to 2021, a 2024
  public notice, and SI 59 of 2026 — so a policy check is not a customs decision and **CarUp declares
  no vehicle un-importable.**
- **`isSailingOperator` is canonical but not yet sole.** T5, T7, T8, T10 and T11's read surface still
  carry private copies. Consolidating them touches frozen lanes and was not taken here.
- **`tests/agents/31` "public route renders normally" fails on Mobile Chrome.** It fails identically
  on the stashed baseline, so it **predates this work and is unrelated to it.** Recorded, not fixed.
- **The repaired `Diaspora Deployed Staging UAT` gate now RUNS and does not pass** — see §2. Five
  specs across the parts, security, seller, T5 and T2 lanes fail, and the suite exceeds the job's
  35-minute timeout at 13 specs × 3 device projects with a single worker. **Owner decision required**
  on scheduling that backlog. It has not been hidden by raising a timeout or narrowing scope.
- **The clearing-agent licence cannot be verified by CarUp at all.** The product says so on every
  surface; closing it needs an authority interface that does not exist.
- Carried forward unchanged: T8's live-OCR and storage-failure residuals; T9's outbox-drain residual.
