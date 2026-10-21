# CarUp Client MVP — Staging Data Reconciliation Report (read-only)

**Environment:** staging Supabase `eoyenigwevnxwwhyhaer`. Production (`vhmnajoeicasaigiophh`) was not queried.
**Captured:** 2026-10-21 between 06:02Z and 06:20Z (UTC from the clock), by the CARUP-MVP-STAB-01 implementation agent.
**Method:** SELECT-only queries, reproduced in [`staging-reconciliation.sql`](staging-reconciliation.sql) (Q1–Q9).
**Mutations performed:** none. `STAGING_ROWS_DELETED = 0`. No row was archived, re-queued, re-published or edited.

## 1. Classification rule (attributable provenance only)

| Class | Rule used | Not used |
|---|---|---|
| Confirmed Owner/client evidence | The object is named as the Owner's own journey in an authoritative document (e.g. the Serena/Kingstone journey, Operations manual §13–14) | — |
| Confirmed automated/test fixture | One of: an email on a reserved test domain (RFC 2606 `example.com/.net/.org`, RFC 6761 `.test`, `.invalid`, `.localhost`, `.example`, and `.local`), which no real customer can receive mail at; the product's own automation marker (`seller_description` starting `Golden Dynamic Seller`); or a governed quarantine record whose metadata states the row is automated-UAT | Age, repeated wording, volume |
| Real/unknown | Everything not attributable to the two classes above | — |
| Orphaned/inconsistent | A row whose state contradicts a related authority (e.g. a lifecycle state with no backing record) — independent of the three classes above | — |

## 2. Findings

### 2.1 Accounts (Q1)
326 users: **315 on reserved test domains** (owner 270, admin 26, dealer 14, bank 2, government 1, insurance 1,
mechanic 1) → confirmed automated/test identities; **11 on public domains** (owner 10, admin 1) → real/unknown.
These figures describe accounts only; whether a public-domain account belongs to the Owner is not inferred.

### 2.2 Vehicles (Q2, Q9)
364 vehicles. Exactly **one is published and Available: Serena GFC27-027051** (Owner/client evidence). 40 are
published but Sold (21 carry the `Golden Dynamic Seller` automation marker, 19 have reserved-domain owners), 232 are
`publishable`, 92 are `draft` (47 golden fixtures). Every non-Serena vehicle has a reserved-domain owner, an automation
marker, or no owner row.

**Inconsistency:** 2 vehicles store commerce status `available` (lowercase) while 74 store `Available`.

### 2.3 Inquiries ↔ canonical conversations (Q3, Q4)
The canonical link is a `message_threads` row with `subject_type = 'marketplace_inquiry'` and
`subject_id = <inquiry id>`. Threads from 2026-08-12 onward also stamp `metadata.marketplace_inquiry_id`
("exact" threads); 16 earlier threads carry only the subject key.

| | All staging | Serena GFC27-027051 |
|---|---|---|
| Inquiries | 325 (142 listings) | **36** |
| With a canonical conversation | 230 (214 exact + 16 legacy) | **33** (all exact) |
| Duplicate conversations for one inquiry | 0 | 0 |
| Conversations pointing at a missing inquiry | 0 | 0 |
| Without a conversation | 95 | **3** |
| …event quarantined `STALE_HISTORICAL_QUARANTINE` | 76 | 3 |
| …event quarantined `SUPERSEDED_HISTORICAL_WORK` | 5 | 0 |
| …no event at all (rows from 2026-06-17, before event emission existed) | 14 | 0 |
| …event pending / failed / dead-lettered | **0** | 0 |

Serena detail: 35 inquiries are signed-out web inquiries from reserved test domains (confirmed automated), and 1 is a
signed-in Native inquiry created 2026-10-21T03:52:36Z whose text is the Native template
"I am interested in this vehicle." (real/unknown; it matches the Owner-reported automatic-send defect, which is an
INFERENCE, not an attribution). The 33 Serena conversations hold 33 inbound messages and **0 replies** (no fabricated
reply exists).

The three Serena inquiries without a conversation were created 2026-09-26 and their `marketplace.inquiry.created`
events were deliberately quarantined on 2026-10-10 by OC-5R PC01-D (frozen set `D_MARKETPLACE`, authority
`bcd7076a`) with the recorded rule: *automated-UAT guest inquiry (reserved test domain), listing not live in public
commerce, no prior notification, single event per inquiry; delivery would open push/email/WhatsApp/SMS.*

**Conclusion:** no legitimate inquiry is stuck between "inquiry" and "conversation". The 36 vs 33 difference on Serena
is three governed, intentionally quarantined automation rows. They remain inquiries without conversations; the product
must therefore label the two numbers separately and truthfully (36 inquiries, 33 conversations).

### 2.4 Garage / professional onboarding (Q5)
`garage_applications`, `garage_application_decisions` and `garage_invitations` contain **0 rows**. 8 garage tenants and
19 `tenant_users` exist (pre-onboarding fixtures; none was created by `activate_garage_application`). 4 garage
`garage_public_profiles` exist, all `unpublished`.

**Inconsistency:** 4 registration profiles are `professional_services / garage / in_review` with **no** garage
application behind them, and 3 are `professional_services / dealer / requested`.

### 2.5 Container co-loading (Q6, Q7)
68 sailings are stored `BOOKING_OPEN`; **36 of them have a passed booking deadline and a passed departure date.**
Reservations were accepted against expired sailings: **24 reservations were created after their sailing's booking
deadline** (latest 2026-10-12), and **26 reservations are still `REQUESTED`** on sailings that have already departed.
These confirm the eligibility defect the product fix addresses (stored lifecycle ≠ current booking eligibility); the
stored statuses are not changed by this report.

### 2.6 Latent external sends (Q8)
With the outbound kill switch active nothing leaves CarUp, but **3 external notifications are `retry_scheduled`**:
2 email (2026-10-20) and 1 WhatsApp (2026-08-13). A future release of the kill switch would attempt them unless they
are dispositioned first.

## 3. Proposed mutation ledger — NOT APPLIED

Nothing below is authorized by this work unit. Each item needs an explicit, separate authorization and is written as an
audited, reversible state transition rather than deletion.

| # | Proposed action | Rows | Mechanism (preferred) | Why | Reversal |
|---|---|---|---|---|---|
| M1 | None for the 81 quarantined inquiry events | 81 | — | The quarantine is a governed decision with its own authority; re-queuing would open external delivery | — |
| M2 | Optional: canonicalize the 14 pre-event (2026-06-17) inquiries into conversations with no notification | 14 | The idempotent reconciliation path (dry-run first, then an authorized apply) | Only if the Owner wants historical rows visible in Communications; 13 of the 14 are reserved-domain guests | Close the created threads (status transition) |
| M3 | Operator closes expired `BOOKING_OPEN` sailings | 36 | Existing operations close action (`BOOKING_CLOSED`), audited | Stored lifecycle should match reality for operations reporting; the buyer-facing eligibility fix does not depend on it | Re-open by operator |
| M4 | Disposition `REQUESTED` reservations on departed sailings | 26 | Existing reviewer reject/cancel with reason | They can no longer be fulfilled | — |
| M5 | Cancel the 3 `retry_scheduled` external notifications before any outbound release | 3 | Governed dead-letter/cancel endpoint | Prevent unintended sends | Requeue by explicit decision |
| M6 | Normalize the 2 lowercase `available` commerce statuses | 2 | Audited update through the owning service | Spelling drift | Revert |
| M7 | Reconcile 4 garage profiles `in_review` without applications | 4 | Applicant continues into the governed application, or the profile returns to `requested` by an audited correction | State has no backing record | — |
