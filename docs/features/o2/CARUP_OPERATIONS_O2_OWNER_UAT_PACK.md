# O2 — Product Owner UAT Pack (2026-09-04)

**Candidate:** product/certification `7eba353f` · deployed docs head `125ab10e`
(product tree byte-identical — only `docs/` differs, proven by
`git diff --name-only 7eba353f 125ab10e -- . ':!docs'` returning nothing).

| Surface | URL |
|---|---|
| Frontend (staging preview) | https://carup-staging-git-feat-operations-o2-people-compliance-11-11.vercel.app |
| Backend (paired preview) | https://carup-backend-staging-git-feat-operations-o2-peopl-b8a9c6-11-11.vercel.app |

Verified live before handoff: both READY on `125ab10e`; frontend reports
`unpaired: false` and names the paired backend (no fallback to `main`); backend
`status: UP`, `provenance_available: true`, approved staging database with all six O2
migrations live; **live biometric provider NOT CONFIGURED**.

## Accounts and assets (staging-only synthetics — never a real person)

| Account | Email | Password | Purpose |
|---|---|---|---|
| Individual | `po.uat.owner@carup-staging.test` | `CarUpUAT-Synthetic-2026!` | individual routing, workbook tools, assurance |
| Dealer applicant | `po.uat.dealer@carup-staging.test` | `CarUpUAT-Synthetic-2026!` | business/dealer routing, dealer onboarding |
| New account | you create it in §1 | your choice | registration journey from zero |

Both accounts were created through the **real signup API** (no database editing) and are
`role=owner` — signup grants no privilege, by design.

**Identity images:** use ONLY the supplied synthetic files in
`docs/features/o2/uat-assets/` — `synthetic-id-front.png`, `synthetic-id-back.png`,
`synthetic-selfie.png`. Each is stamped **"SYNTHETIC TEST ASSET — NOT A REAL IDENTITY
DOCUMENT"**. **Never upload a real passport, ID or photo of a real person to shared staging.**

Reviewer-side steps (approving an identity, deciding Dealer Compliance) need an Operations
account; if you want to exercise them, ask and one will be provisioned — the checklist below
is written so every item is judgeable **without** reviewer powers.

---

## The checklist

Mark each PASS / FAIL. "Path" is appended to the frontend URL.

### 1 · Registration and Registration Profile
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 1.1 | `/register` | none | Create a new account with any synthetic email you like | Account is created and you land signed in. You are never asked to choose a privileged role | ☐ |
| 1.2 | `/onboarding` | new account | Read the top of the page | A heading, a "Your action needed"-style badge, and one plain-English next action — no jargon codes | ☐ |
| 1.3 | `/onboarding` | new account | Complete the context form (individual, Zimbabwe, city, intended use), Save | Values save and stay after saving | ☐ |
| 1.4 | `/onboarding` | new account | Reload the page (F5), then sign out and back in | Everything you entered is still there — the journey resumes from the server, not the browser | ☐ |

### 2 · Individual vs business/dealer routing
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 2.1 | `/onboarding` | `po.uat.owner` | Look for any dealer entry point | No "Start Dealer onboarding" button — this is an individual account | ☐ |
| 2.2 | `/onboarding` | `po.uat.dealer` | Look again | A "Start Dealer onboarding" button IS offered (business + dealer context) | ☐ |
| 2.3 | `/dealer/onboarding` | `po.uat.owner` | Type the path directly | You are refused with an honest message — typing the URL grants nothing | ☐ |

### 3 · Identity journey — candidates are not verification
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 3.1 | `/onboarding` | new account | In Identity verification pick "Zimbabwe National ID", click Start verification | An upload area appears for front / back / selfie | ☐ |
| 3.2 | `/onboarding` | new account | Upload the three **synthetic** images | Each side shows an uploaded state; you can replace one | ☐ |
| 3.3 | `/onboarding` | new account | Submit them | Status becomes "in review"/processing — **never "Verified"**. Nothing claims you are verified because a file was uploaded | ☐ |
| 3.4 | `/onboarding` | new account | Inspect the extracted-values area (the mandatory check in §3A measures this properly) | Any value present is labelled as a suggestion you must accept or correct — the page never fills your profile silently, and never shows "N/A"/"Unknown" as if it were data | ☐ |
| 3.5 | `/onboarding` | new account | Look at the locked-capabilities list | Selling publicly, Dealer tools, vehicle registration and Vehicle Trust are each listed as locked by their OWN authority — identity verification is never said to grant them | ☐ |

### 3A · MANDATORY — Live OCR Operational Check

**Purpose:** prove whether the deployed candidate can read known values out of the ACTUAL PIXELS
of a synthetic identity document. This is not a "does a suggestion appear" question. Either the
extraction reads the fixture's known values, or it does not, and the result is recorded as such.

**Fixture:** `docs/features/o2/uat-assets/synthetic-id-front.png`, expected values recorded in
`docs/features/o2/uat-assets/FIXTURE_EXPECTED_VALUES.md` — surname `SPECIMEN`, given names
`UAT SYNTHETIC`, document number `SPECIMEN-0000-UAT`, DOB `01 JAN 1990`, expiry `01 JAN 2035`.
1012 × 638 px, high-contrast, 24–54 px type: legible to any working OCR/vision model.

| # | Path | Account | Do this | Record | PASS/FAIL |
|---|---|---|---|---|---|
| 3A.1 | `/onboarding` | new account | Start verification, upload the three synthetic files, Submit | The status the product shows after submission | ☐ |
| 3A.2 | `/onboarding` | same | Look for extracted values | **Extracted FIRST NAME** — value shown, or "none extracted" | ☐ |
| 3A.3 | `/onboarding` | same | " | **Extracted LAST NAME** — value shown, or "none extracted" | ☐ |
| 3A.4 | `/onboarding` | same | " | **Extracted DOCUMENT/ID NUMBER** — value shown, or "none extracted" | ☐ |
| 3A.5 | `/onboarding` | same | " | **Extracted DATE OF BIRTH** (where the document carries one) — value, or "none extracted" | ☐ |
| 3A.6 | `/onboarding` | same | " | **Provider / model provenance** — which extractor ran, or "no provider recorded" | ☐ |
| 3A.7 | `/onboarding` | same | " | **Extraction success or failure**, with the reason the product gives | ☐ |
| 3A.8 | `/onboarding` | same | " | **Candidate status** — candidates available/unavailable and why | ☐ |

**Comparison rule.** For 3A.2–3A.5, compare what the product shows against the fixture values
above. A value that does not match the fixture is a FAIL and must be reported verbatim — a
plausible-looking name that is not `UAT SYNTHETIC SPECIMEN` would be fabrication, which is worse
than extracting nothing.

**Verdict to record:**

- **LIVE OCR OPERATIONALIZED** — the extraction read the fixture's values from the image and
  presented them as candidates with provider provenance; or
- **LIVE OCR OPERATIONALIZATION — NOT READY** — the extraction did not read the actual image.

The verdict is recorded as observed. Routing to manual review is a correct SAFETY behaviour and
is NOT a substitute for extraction: if nothing was read from the pixels, the check is NOT READY
even though the journey continued safely.

#### Separately: extraction ≠ verification

| # | Do this | Expect | PASS/FAIL |
|---|---|---|---|
| 3A.9 | Whatever 3A.2–3A.5 showed, look at your identity status | The account is **not** verified. Reading a document is not a decision about a person | ☐ |
| 3A.10 | Look at the assurance/status wording | Assurance is `pending`/`not established` — never "established" because a file was processed | ☐ |
| 3A.11 | If values WERE extracted | They are labelled as candidates you accept or correct; none is written to your profile silently | ☐ |

#### Result observed on this candidate before handoff (2026-09-04)

**LIVE OCR OPERATIONALIZATION — NOT READY.** Measured on the deployed pair at `7786e95a` by
running the real journey with the real synthetic pixels (session
`e5b2d39e-0f81-403f-9511-b63afbf47ac8`, account `po.uat.owner@carup-staging.test`):

| Evidence | Observed |
|---|---|
| Uploads (3 × ~80 KB PNG) | HTTP 200 — the real images were accepted |
| Submit | HTTP 200 |
| `ocr_execution_status` | `null` |
| `ocr_document_id` | `null` |
| `ocr_result` | `null` |
| `extraction_trust_status` | `null` |
| `confidence_score` | `null` |
| Extracted first name / last name / document number / DOB | **none extracted** (no field of any kind) |
| Provider / model provenance | **none recorded**; `/api/health` reports `ocrProviders: {gemini:false, groq:false, openrouter:false, moonshot:false}` |
| `failure_reason` | `Classification provider unavailable.` |
| `primary_reason_code` | `DOCUMENT_NOT_VISIBLE` |
| Candidate status | `available: false` — "Extraction has not completed for your current verification session." |
| Session status / phase | `pending_manual_review` / `reviewer_action_required` |
| Identity state · assurance | `in_review` · `pending` (`not_established`) — **not verified** |

**Reading of this result.** No OCR/vision provider is configured on this preview environment, so
no extraction ran and **zero** fields were read from the image. The pipeline did not fabricate a
name, a number or a confidence score, and did not claim verification — it recorded an honest
failure reason and routed to human review. The truth model therefore holds (nothing invented,
extraction ≠ verification), while **live OCR operationalization is NOT READY** on this
deployment. This is an environment/provider-activation gap, recorded rather than hidden behind
the manual-review fallback; closing it requires an OCR provider credential decision, which is a
Product Owner call and is outside the frozen O2 product scope.

Please still perform 3A.1–3A.11 yourself: if you observe anything different from the table
above — in particular any extracted value — report it, because a value appearing without a
configured provider would be a serious finding.

### 4 · Biometrics (provider deliberately not activated)
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 4.1 | `/onboarding` | new account | Find the biometric consent block | The consent box is **unticked**; the text explains face↔document matching, liveness, provider processing and withdrawal | ☐ |
| 4.2 | `/onboarding` | new account | Tick consent and run the check if offered | It reports honestly that the check is unavailable / manual review follows. **Nothing ever claims a successful face match or liveness pass** | ☐ |

### 5 · Account security / step-up
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 5.1 | `/onboarding` | any | Look for security/lifecycle messaging if your account is in a hold state | Applicant-safe wording only — no internal notes, no reviewer identities, no anti-fraud detail | ☐ |
| 5.2 | any | any | (If you have an Operations account) attempt a sensitive review action | You are asked to re-prove your password before it proceeds | ☐ |

### 6 · Dealer applicant onboarding
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 6.1 | `/dealer/onboarding` | `po.uat.dealer` | Open the page | Your own application only. A badge reads **"Applicant — not an active Dealer"** | ☐ |
| 6.2 | `/dealer/onboarding` | `po.uat.dealer` | Fill business identity (legal name, trading name, country), Save | Saves and reloads correctly | ☐ |
| 6.3 | `/dealer/onboarding` | `po.uat.dealer` | Read the workspace/dependency note | It says plainly that Dealer tools unlock only through a governed Dealer relationship — a business application alone never does | ☐ |
| 6.4 | `/dealer/onboarding` | `po.uat.dealer` | Read the compliance section | The eight compliance dimensions show as-is with "can publish: false" — decided by CarUp review, not by this form | ☐ |
| 6.5 | `/dealer` or the dealer dashboard | `po.uat.dealer` | Try to reach the Dealer workspace | You are NOT admitted — applying is not activation | ☐ |
| 6.6 | `/dealer/onboarding` | `po.uat.dealer` | Upload a synthetic document as evidence | It is recorded privately; the page shows that a file exists, never a storage link/path | ☐ |
| 6.7 | `/dealer/onboarding` | `po.uat.dealer` | If extraction offers candidate values | They appear as suggestions with explicit "use" buttons — nothing is applied automatically | ☐ |

### 7 · Workbook Tools + CarUp AI Workbook Assistant
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 7.1 | `/workbook-tools` | `po.uat.owner` | Open the page | You see "My Vehicle Listings" and a list of what is NOT available with plain reasons | ☐ |
| 7.2 | `/workbook-tools` | `po.uat.dealer` | Open the page | You additionally see "Dealer Vehicle Inventory" — the catalogue follows your real context | ☐ |
| 7.3 | `/workbook-tools` | either | Tabs: Template / Export / Import / Recent Imports | All four are present | ☐ |
| 7.4 | `/workbook-tools` | either | Template → Download template | An .xlsx downloads. Open it: readable column names (e.g. "Registration stage", "Who can see the vehicle location?"), a help row, dropdowns, and an Instructions sheet | ☐ |
| 7.5 | Excel/Sheets | — | Fill 1–2 vehicles (VIN, make, model, year, colour, mileage, body style, condition, fuel, transmission; price, currency, city, description ≥50 chars). Delete the EXAMPLE row | The file behaves like a normal spreadsheet; dropdowns work | ☐ |
| 7.6 | `/workbook-tools` | same account | Import → choose your file → Inspect workbook | A mapping table appears. The **CarUp AI Workbook Assistant** panel is clearly visible and explains that it proposes while you decide | ☐ |
| 7.7 | `/workbook-tools` | same | Look at the "Source" column | Matches are labelled — exact matches vs a distinctly marked **AI PROPOSAL** vs unmapped. You can change any of them | ☐ |
| 7.8 | `/workbook-tools` | same | Click "explain" on a column | A plain-English explanation with the permitted values | ☐ |
| 7.9 | `/workbook-tools` | same | Try "Run dry run" BEFORE confirming the mapping | It is disabled — the human confirmation is required first | ☐ |
| 7.10 | `/workbook-tools` | same | Confirm mapping → Run dry run | A summary appears including a line stating **0 authority decisions will be imported**, plus any rows needing attention | ☐ |
| 7.11 | `/workbook-tools` | same | Confirm import | It reports how many were created **as private drafts** and says nothing is published by an import | ☐ |
| 7.12 | `/dashboard` → My Vehicles | same | Open one imported vehicle | Your imported values are there — **you do not retype them**. Publication is still a separate step | ☐ |
| 7.13 | `/workbook-tools` | same | Recent Imports tab | Your import is listed with file, time, counts and status. Another account's imports are never shown | ☐ |
| 7.14 | `/workbook-tools` | same | Export → Export my data | An .xlsx downloads containing your own data; sensitive identifiers (engine/chassis) show as `[REDACTED]` | ☐ |

### 8 · Assurance, who-must-act, notifications
| # | Path | Account | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|---|
| 8.1 | `/onboarding` | any | Read the identity status area | One consistent status with a plain next action; history ("approved before") is never presented as current when re-verification is required | ☐ |
| 8.2 | `/dealer/onboarding` | `po.uat.dealer` | Read the responsible-person identity block | Identity status is shown alongside — never merged into — the dealer application's own status | ☐ |
| 8.3 | notifications bell / `/dashboard` | any | After a governed event (e.g. an import completing) | A notification appears from the governed event. It contains no document contents, links to private evidence, or reviewer notes | ☐ |
| 8.4 | anywhere | any | Look at any "who must act" wording across pages | Consistent vocabulary everywhere (your action / with CarUp review / with an external authority / nothing outstanding) | ☐ |

### 9 · Operations surfaces (only if you have an Operations account)
| # | Path | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|
| 9.1 | `/admin` → People/Compliance | Open a person's review | Email verification, identity, seller authority and dealer compliance appear as **separate** facts — never one merged "verified" badge | ☐ |
| 9.2 | same | Look for identity artifacts | No document images, OCR payloads or storage paths in the aggregate; evidence opens only through its own audited preview | ☐ |

### 10 · Appearance
| # | Path | Do this | Expect | PASS/FAIL |
|---|---|---|---|---|
| 10.1 | `/onboarding`, `/dealer/onboarding`, `/workbook-tools` | View on desktop | Readable, nothing overlapping, text has clear contrast | ☐ |
| 10.2 | same | View on a phone (or narrow the window) | Layout adapts; tables scroll rather than breaking the page; buttons reachable | ☐ |

---

## Reporting

For any FAIL please note: the item number, the account used, what you saw, and the URL.
A blocker will be classified, corrected in isolation, re-certified against this same candidate,
and the receipts updated — no scope beyond the proven blocker.

## Known and deliberate (not defects)

Dealer activation (approved applicant → active Dealer) has **no governed path yet** — an
open Product Owner decision; the product says so honestly rather than guessing. Garage/mechanic
workbooks are deferred behind Service Network PR #197. The live biometric provider is **not
activated**, so biometric checks truthfully report unavailable. **No OCR/vision provider is
configured on this preview either — see §3A: LIVE OCR OPERATIONALIZATION — NOT READY.** Communications delivery on this
preview is provider-blocked (in-app notifications work; email/WhatsApp are not configured here).
