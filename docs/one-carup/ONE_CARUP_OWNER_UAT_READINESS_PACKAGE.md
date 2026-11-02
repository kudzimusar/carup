# One CarUp — Owner UAT Readiness Package

**For:** the Product Owner, who will physically perform Owner UAT on the staging preview below.
**Prepared by:** the OC-5R-REL-02 release run. This package is **not** Owner UAT and carries no Owner-UAT attestation. Only a human can issue that.
**Release:** PR #222 (Draft, unmerged) · branch `fix/oc5r-real-runtime-source-closure`.

## 1. Where to test

| | |
|---|---|
| **Web app** | https://carup-staging-oc5r-rel02-11-11.vercel.app |
| **API** | https://carup-backend-staging-oc5r-rel02-11-11.vercel.app (health: `/api/health`) |
| **Exact SHA** | `24a149334beb25932ebcafdb829463a65fce17f1` (the frontend, the backend and `/carup-provenance.json` all state it) |
| Code under test | `ff50ba347b8cd43f144b320195bdcd18c98ffbd5` (the deploy commit adds documents only; the two alias records are inherited from an earlier commit) |
| Deployments | frontend `dpl_7DM7w7mTE5AesWueu2i6a6rjMHEG` · backend `dpl_796CYuhndXadx1TTvHjPWcFmJDfa` (Vercel **preview**, not production) |
| Database | the canonical staging project `eoyenigwevnxwwhyhaer` only |

**Do not use** `carup.dev`, `api.carup.dev`, `staging.carup.dev`, `carup-staging.vercel.app` or `carup-backend-staging.vercel.app`. This preview is separate from all of them, and none of them was changed.
The earlier REL-01 aliases (`…-oc5r-rel01-11-11`) still serve the REL-01 build and are not part of this UAT.

**Check what you are testing**
- Open `…/carup-provenance.json`: `commit_sha` must be `24a149334beb25932ebcafdb829463a65fce17f1` and `unpaired` must be `false`.
- Open `…/api/health`: `build.commit_sha` must match, `database.consistent` must be `true`, and `communications.outbound.kill_switch` must be `active`.

## 2. Accounts (no secrets here)

- **Passwords are not in this repository or this document.** They live in the GitHub **staging environment** secrets, which the Product Owner controls. Never paste one into a chat or ticket.
- **Staging identities** (all on the reserved `@carup-staging.test` domain):

| Use | Email | Secret name |
|---|---|---|
| Buyer / Seller (owner role) | `uat.buyer@carup-staging.test` | `STAGING_UAT_BUYER_PASSWORD` |
| Dealer-role seller | `uat.seller@carup-staging.test` | `STAGING_UAT_SELLER_PASSWORD` |
| Reviewer (admin) | `uat.reviewer@carup-staging.test` | `STAGING_UAT_REVIEWER_PASSWORD` |
| Trade OS operator for Hikari Co-Load | `tradeos.operator@carup-staging.test` | `TRADEOS_UAT_OPERATOR_PASSWORD` |
| Trade OS participants A and B (no organisation) | `tradeos.participant.a@…` · `tradeos.participant.b@…` | `TRADEOS_UAT_PARTICIPANT_A_PASSWORD` · `…_B_PASSWORD` |
| Rival organisation admin (isolation test) | `tradeos.outsider@carup-staging.test` | `TRADEOS_UAT_OUTSIDER_PASSWORD` |

- You can also **register a fresh account** on the preview: public registration creates an ordinary `owner`. That is the cleanest way to try a first-time Seller journey.
- **Choosing an organisation is always your tap.** Signing in never puts you "inside" an organisation, even if you belong to only one. Use the **"Act for …"** prompt or the switcher in the header.

## 3. Journeys to perform

For each, the automated evidence shows the path **works**; your judgement is whether it **feels right**.

**Seller**
1. **Sell a vehicle.** Sign in → My Garage → add a vehicle with three or more photos → upload the registration document → publish.
   - *Expect:* the publication gate refuses until ownership evidence is verified, then allows it. The listing then appears on Marketplace.
2. **The Vehicle Passport.** Open the vehicle from My Garage.
   - *Expect:* the page says **Vehicle Passport**, with the vehicle's name and VIN beneath it, its trust summary, documents and evidence. Loading and error states keep their own wording.
3. **Unpublish, republish, mark sold.**
   - *Expect:* unpublish removes it from Marketplace and Home. Republish returns it. After **Sold** it leaves both, and the Passport page still opens.
4. **Navigation.** Move between My Garage, Evidence Vault and My Listings on a desktop, a tablet and a phone.
   - *Expect:* the sidebar highlights exactly one destination. The phone's bottom bar also highlights its own.

**Buyer**
5. **A listing at tablet width.** Open any published listing on a tablet-size window (about 820 px).
   - *Expect:* **Ask about this vehicle** and **Request an inspection** can be tapped normally once scrolled into view. Neither is stuck behind the bottom bar.
6. **The cost estimate.** *Expect:* an all-in **cost** estimate and the sentence "No market valuation…". There is **no** fair price and **no** price range.
7. **The buyer assistant.** Sign in, open the assistant and ask a question.
   - *Expect:* AI-assisted safe guidance within a few seconds, with no price or value claims. If the AI is slow you will be told so and shown the standard guidance.

**Garage and documents**
8. **Odometer photo.** Upload an odometer photo as evidence, even choosing "public".
   - *Expect:* it is stored **private**. Running the reading gives a **candidate for review**, never a recorded mileage.

**Trade OS (Hikari Co-Load operator)**
9. Sign in as the operator → choose **Act for … Hikari Co-Load** → Trade OS → Container Co-Loading → create a container → as participants A and B request space → approve, reject, and try an overfill → try the rival admin.
   - *Expect:* the organisation name appears in the header only after you choose it. The overfill is refused. The rival organisation sees none of it.

**Communications**
10. Open Communications and the notifications bell. *Expect:* in-app notifications appear. **Nothing leaves CarUp** (see §5).
   - **Known gap on this preview:** a Trade OS booking you make here will **not** produce a new in-app notification, because the preview's event worker is not authorised (§9, item 1).
   - Booking notifications you may see are from **September 2026** test runs. Do not mistake them for yours.

## 4. Known limitations

- **Qwen / OCR accuracy.** The odometer reader is **evidence-grade only**.
  - In two deployed runs it read the synthetic image drawn as `084213` as `4213`, dropping two leading digits.
  - It is always a candidate that a person reviews. It never sets mileage, trust or authority.
  - **No accuracy is claimed.** The 11-fixture accuracy gate has not been run.
- **Gemma.** Advisory only: it produces suggestions, never a decision. Its answers are labelled as AI-assisted.
- **No valuation.** CarUp has no approved valuation provider, so no "fair value" or price range is shown anywhere.

## 5. Deliberately unavailable

| Provider | State on this preview |
|---|---|
| **All outbound communications** (email, WhatsApp, Telegram, SMS, push) | **Held by the kill switch.** `COMMUNICATION_OUTBOUND_DISABLED=true` is set on this deployment only. Messages are refused before any request, queued and retried in an hour; in-app notifications are unaffected. |
| Valuation provider | None approved. |
| SafeTrade / payments, escrow | Not contracted; they refuse to execute. |
| Government registries, insurers, lenders | Sandbox only; not contracted. |
| Biometrics | Interface only; not activated. |
| Webhooks (Meta, Resend, Telegram, finance, insurance, escrow) | Not configured on staging; they fail closed. |
| The Trade OS worker secret | Not present on the preview runtime; see the release record for what that blocks. |

## 6. What the database is, and is not

- It is the **staging** database. **It is not production and it says nothing about production data or behaviour.**
- It holds **synthetic** fixtures. All 147 retired seed rows are absent. There is no synthetic reference media.
- Automated runs leave their own test accounts, vehicles (all **Sold**, none public) and their evidence and audit records.
  - Append-only audit and provenance rows **cannot be deleted** by design.
  - The release record classifies every row a run added.
- Anything you create during UAT stays in staging. Mark your own test listings as **Sold**, or unpublish them, so they do not remain in public commerce.

## 7. How to reverse this

- **Nothing user-facing needs rolling back.** No stable or production alias was moved; the preview is simply not used.
- **To retire the preview:**
  - remove the two REL-02 aliases (`vercel alias rm <alias> --scope 11-11`);
  - optionally remove the deployments;
  - leave PR #222 unmerged, or close it.
- **To stop outbound-hold behaviour on a future build:** deploy without `-e COMMUNICATION_OUTBOUND_DISABLED=true`. That is a **decision**, not part of UAT. Never set that variable on production.
- **Environment follow-ups:**
  - `SUPABASE_DB_URL` stays removed from the **Preview** target (owner decision 2026-10-07).
  - The stale `CLOUDFLARE_TOKEN` is still on the production target and should be removed.
- **Data:** nothing was changed in production. Staging fixtures can be quarantined with the established DB2B procedures; append-only audit stays.

## 8. Recording the result

Record your Owner-UAT outcome yourself. Owner-UAT receipts are issued **only** from a named person's attestation, never inferred from automated runs.

**Evidence already on the branch**
- `docs/one-carup/certification/OC5R_REL02_STAGING_RELEASE_RECORD.json`
- `docs/one-carup/OC5R_REL02_STAGING_RELEASE_REPORT.md`
- `docs/one-carup/certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`

## 9. Known blockers to a full sign-off

1. **Staging secret custody (D7), the one exact blocker.**
   - **What fails.** The candidate backend's Preview target has no `COMMUNICATION_WORKER_SECRET` (or `CRON_SECRET`), so `POST /api/internal/events/process` answers **401** to the GitHub staging secret `TRADEOS_WORKER_SECRET`. On this preview, Trade OS booking events are therefore never turned into in-app notifications.
   - **Who decides.** Only the owner can supply the worker secret to the preview runtime (for example deployment-scoped at the next deploy), with custody of its value.
   - **What this run did not do.** It added no secret and rotated none.
2. **D7 is not scoped to its own run.** It passes on any historical `container_booking` notification. Scoping it to the run's reservation is a harness change that needs moderator authorisation, because D7 was to run unchanged.
3. **Not provisioned.** The Kingstone staging credentials (spec 43, 3 tests) and the T3 fixtures (spec 47, 2 tests) are missing, so those tests skipped.
4. **Owner decisions still open:**
   - Seller Q (Communications) stays fixme until owner decision D.
   - Qwen accuracy is not claimed, and the 11-fixture gate has not been run.
   - The stale `CLOUDFLARE_TOKEN` should be removed from the production target.
5. **Undrained events.** This run's staging events remain undrained in `domain_events`. If a staging worker drains them later, the deployment that drains them decides whether its outbound kill switch applies.
6. **Owner UAT.** Only the Product Owner can perform and record it. Nothing here claims it.
