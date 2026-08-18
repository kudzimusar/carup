# X2 resumption packet

**Purpose:** when PR #165 (Canonical Vehicle Truth Closure) merges, X2 must start immediately without a second
broad discovery. Everything already established is in the sibling documents; this packet contains **only** what
must be re-checked and the order of work.

**Do not re-run a full X0.** X0 is complete and accepted (`87db689a`). Refresh **deltas only**.

---

## 1. Reconcile against the new `main`

```bash
git fetch origin
git checkout feat/email-experience-design-system-1-0
git rebase origin/main
git log --oneline origin/main -1        # record the new main SHA here
```

Record: `NEW_MAIN_SHA = ____________`  (was `940c22353fbd759652791bf1c286812856092f85` at X0)

Confirm PR #166 is canonized (the canonical plan is on `main`), and apply the recorded plan amendment:
**R1 "CEO Welcome" → "Leadership Welcome"**, `ceo_welcome` → `leadership_welcome`, `CEO_*` → `LEADERSHIP_*`.

## 2. Delta-review the eleven Vehicle Truth contract surfaces

These define what the email vehicle/trust components may read and display. Re-read each and record what
changed; nothing else from X0 needs revisiting.

```bash
git diff 940c2235..origin/main -- \
  backend/utils/publicVehicleProjection.js \
  backend/utils/passportLookupPolicy.js \
  backend/utils/vehicleStatus.js \
  backend/services/trustDecision/canonicalTrustService.js \
  backend/services/trustDecision/trustDecisionService.js \
  backend/services/marketplace/marketplaceTrustSummaryService.js \
  backend/services/marketplace/listingSummaryService.js \
  backend/services/marketplace/marketplaceListingDetailService.js \
  backend/services/marketplace/marketplaceListingEligibility.js \
  backend/services/evidence/vehicleFactResolver.js
git diff 940c2235..origin/main -- backend/tests/issue164-phase4-seller-location.test.js
```

| # | Surface | Email consumer | Delta? |
|---|---|---|---|
| 1 | `publicVehicleProjection.js` | **what vehicle data may appear in an email at all** | |
| 2 | `canonicalTrustService.js` | Trust Score + provenance (R5) | |
| 3 | `trustDecisionService.js` | trust decision semantics | |
| 4 | `marketplaceTrustSummaryService.js` | trust badge / verification indicator | |
| 5 | `listingSummaryService.js` | vehicle card summary fields | |
| 6 | `marketplaceListingDetailService.js` | conversation vehicle context (R3) | |
| 7 | `marketplaceListingEligibility.js` | whether a listing may be shown | |
| 8 | `vehicleFactResolver.js` | evidence checkmarks (R5) | |
| 9 | `passportLookupPolicy.js` | Passport exposure policy (R5) | |
| 10 | `vehicleStatus.js` | listing status badge | |
| 11 | seller/location canonicalization | vehicle card seller + location | |

**Binding rule (unchanged):** read vehicle and trust data **through** these services. Never re-derive trust,
never re-project vehicle fields, never surface a field the public projection excludes.

## 3. Re-run before claiming anything

```bash
# staging runtimes must both be on the new main before any certification claim
node scripts/assert-staging-runtime-parity.mjs "$(git rev-parse origin/main)"

# baseline the suite BEFORE touching source, so "beyond baseline" stays meaningful
node --test backend/tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"

# these must keep passing unchanged throughout X2 — auth email is P0 and physically certified
node --test backend/tests/email-webhook-and-reply-routing.test.js \
            backend/tests/email-stakeholder-matrix.test.js \
            backend/tests/staging-runtime-parity.test.js

# canonical CI must be green on the exact SHA — a local green suite is NOT CI green
gh run list --branch feat/email-experience-design-system-1-0 --limit 8
```

## 4. Implementation order

Foundation before templates — plan §4 forbids implementing layer 3 while ignoring the shared layers.

```text
1  identity config layer        frozen B1/B2/B3 values; empty-but-present for deferred fields
2  brand tokens + shell         evolve authEmailTemplates.js BRAND; decompose layout()
3  recipientPresentationName    one `name` column; safe fallbacks; no "Hello undefined"
4  canonical link resolver      builds on backend/config/canonicalWebOrigin.js
5  escaping boundary + tests    BEFORE any dynamic data enters a template  <-- non-negotiable
6  components                   masthead, button, panel, card, badge, signature
7  three footer families        security / transactional-service / marketing-editorial
8  plain-text renderer          first-class, parity-tested
9  sender persona layer         no new sending domains
10 template registry metadata   extend existing tables; no competing database
11 auth migration               3 auth templates onto the shared system, output equivalent
12 worker insertion point       CommunicationDeliveryWorker supplies content.html
13 R1-R6 reference templates    then Gate B4 with real screenshots
```

Steps 1–12 are X2. Step 13 is X3 and ends at **Gate B4**, which is an owner visual approval with real rendered
previews — broad migration does not start before it.

## 5. Where source implementation begins

**First file to create:** the identity config module (step 1) — no existing file to modify, no behaviour
change, and everything else depends on it.

**First existing file to modify:** `backend/services/communication/authEmailTemplates.js` (step 2), decomposing
the private `layout()` while keeping the three auth templates byte-equivalent in rendered output.

**Last file to modify:** `backend/services/communication/communicationDeliveryWorker.js` (step 12). Deliberately
last: until the renderer, footers, escaping and personas are complete and tested, the worker must keep
behaving exactly as it does today. Nothing customer-visible changes until this step.

## 6. Preconditions that are still open at resumption

Check each before the phase that needs it — none blocks starting X2.

| Item | Status | Blocks |
|---|---|---|
| `REGISTERED_LEGAL_ADDRESS` | `DEFERRED_UNTIL_VERIFIED` | Family M / R6 **production rollout** only — footer renders the block conditionally, emitting nothing when unset |
| `LOGO_ARTWORK` | `MISSING` | production rollout; masthead uses the text wordmark meanwhile (plan §11.6) |
| `/support`, `/security` routes | not implemented (return 200 via SPA rewrite) | any template linking them reaching a customer |
| `/email-assets/` serving contract | not created | any template referencing an image |
| `STAFF_ALIAS_ROUTING_PENDING` | 3 rules absent; no catch-all, so mail is rejected | publishing those addresses anywhere customer-facing |
| `WEBSITE_BRAND_IDENTITY_RECONCILIATION` | `REQUIRED` | anti-phishing cross-check (plan §17); sequenced separately |
| `@carup.co.zw` migration | authorized, not performed | footer/website contact consistency |

## 7. Guardrails that do not expire

- Documentation-only until this packet's step 1 is reached **and** the writable lane is genuinely free.
- Never render S.K Musarurwa as **CEO**; the title is Co-Founder & Head of Development.
- Never use `About.tsx` personas, PressKit named individuals, the four legacy entity names, the legacy
  addresses, the three legacy phone numbers, or registration number `14838/2025`.
- No new rendering framework (MJML/React Email) without an owner-approved amendment (plan §21.3).
- No second consent authority; reuse Email 1.0 suppression and unsubscribe.
- Do not enable any catalogue template whose product flow does not exist.
- Provider `delivered` is not visual certification, and a locally-rendered artefact is not proof of what was
  transmitted — Email 1.0 learned both the hard way.
