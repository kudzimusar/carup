# CarUp — Live OCR Operationalization: Receipt

- **Lane:** `fix/o2-live-ocr-operationalization`, branched from
  `feat/operations-o2-people-compliance@71b81d74`
- **Plan:** [CARUP_LIVE_OCR_OPERATIONALIZATION_PLAN.md](CARUP_LIVE_OCR_OPERATIONALIZATION_PLAN.md)
- **Scope:** document field extraction only. O2 stays frozen; PR #208 stays draft; Dealer
  activation, Service Network #197 and biometrics are untouched; nothing is deployed to production.
- This receipt records what changed and what was measured. It does not amend any earlier O2
  receipt.

## 1. What was actually wrong (read from the source, before any change)

| # | Defect | Where it was | Consequence |
|---|---|---|---|
| 1 | Extraction was **not image-based**. `extractDocumentData` called the TEXT client with `Image payload base64: ${base64Data.slice(0, 150)}` — 150 characters of base64 header | `documentIntelligenceService.js:95-99` | The model never saw the document. Any field it returned was invention conditioned on the declared document type |
| 2 | Blur, glare and tamper-suspicion scores were derived from an **MD5 hash** of the payload and returned as measurements | same file `:35-53` | Real `Poor_Image_Quality` and `Suspected_Tampering` verdicts were produced from a digest. Roughly 1 payload in 20 was flagged as tampered by arithmetic on a hash |
| 3 | Persistence filled unread fields with `'Unknown'`, `'N/A'`, **today's date as the date of birth**, `'M'` as sex, `2020` as the year — and reused the **national-ID number** as both the plate number and the customs bill-entry number | same file `:170-201` | The evidence tables recorded identity, vehicle and customs "candidates" no one had read |
| 4 | Confidence was `parsedData.confidenceScore \|\| 0.9`, and the identity gate fell back to the hash-derived **blur score** when none was reported | same file `:101`; `verificationSessionService.js:162,500` | An extraction with no provider confidence could clear the 0.75 verification threshold on a number nothing had measured |

## 2. What changed

**Real vision.** Extraction now goes through `askGeminiVision`, which sends the document bytes as
an `inline_data` part and throws on provider failure. The full payload is sent — the regression
suite decodes the image part from the captured provider call and asserts it equals the original
bytes exactly. Nothing of the payload enters the text prompt, the logs, or the evidence rows.

**Per-document schemas** (`documentSchemas.js`) for the Zimbabwe National ID, passport, driver's
licence, vehicle registration book and customs declaration, plus a business-document schema for
`dealer_*` compliance uploads. Each schema declares its own fields, its own normalizers and its
own core-field set; a registration book has no first-name field to fill and a national ID has no
VIN field to fill.

**Missing stays missing.** There are no runtime defaults left. A value survives only if it was
observed and normalizable:

- absence spellings from the provider (`N/A`, `not visible`, `unknown`, `—`) are read as absence;
- a date is accepted only when the calendar reading is unambiguous — `03/04/1990` is preserved as
  an unnormalized observation with the reason `ambiguous_day_month` rather than silently read as
  either 3 April or 4 March;
- a "VIN" that is not 17 characters, or contains I/O/Q, is not a VIN reading;
- an ICAO sex marker `X` is preserved as an observation with the reason
  `sex_marker_not_representable`, because the evidence column accepts only M or F — it is neither
  dropped silently nor forced into one of the two values the column will take.

**No placeholder rows.** The `ocr_national_ids`, `ocr_registration_books` and
`ocr_customs_declarations` tables are NOT NULL on their identity/vehicle columns, which is exactly
what forced the placeholders. A structured candidate row is now written only when every NOT NULL
column — including the confidence the column demands — was genuinely observed. **Absence of a row
is absence of a candidate.** No migration was required and no historical row was touched.

**Honest quality (disposition B of the plan).** `analyzeImageQuality` no longer estimates
anything. It reports `measured: false` with `not_measured` for blur, glare and tamper suspicion,
alongside the media facts that can genuinely be read from the file header — container format, byte
size, and pixel dimensions parsed from the PNG IHDR or the JPEG SOF marker. `Poor_Image_Quality`
and `Suspected_Tampering` are no longer emitted at all, because CarUp measures neither. The
diaspora OCR panel was updated to match: it now says "Not measured by CarUp" and shows the file
facts, instead of printing a hash-derived blur score to two decimal places.

**Provenance.** Every reading carries provider, model, execution status, requested and observed
document class, schema version, start time, extraction timestamp, latency, bytes sent, media type,
and whether confidence was reported. Confidence is `null` when the provider did not supply one —
never 0.9, never a blur score, and never a substituted 0 that would read as "zero confidence".

**Honest failure, distinct from an empty reading.** A provider that is unconfigured, unreachable,
or that returns malformed output records `executionStatus: provider_failed` and
`OCR_Provider_Unavailable`, with no fields. A provider that answered but read nothing records
`provider_succeeded` and `Pending_Manual_Review`. A file the provider cannot read (a text file, an
empty payload) is refused **before any bytes are sent** and records `not_attempted`.

**Test-mode simulation is labelled as simulation.** It remains gated on
`NODE_ENV=test && ALLOW_OCR_MOCK=true`, it is unreachable once a provider key is configured, and
everything it produces is stamped `provider: 'mock'`, `executionStatus: 'simulated'`. The failure
path no longer substitutes a sample document at all, so a real failure can never be dressed up as
a reading.

## 3. The accuracy corpus and gate

`backend/tests/tools/generate-ocr-corpus.mjs` renders eleven fixtures from the field values in
`ocr-corpus-manifest.json`, so the expected values **are** the pixels — the answer key cannot
drift from the image. Every document, person, number and vehicle is fictional and every fixture
carries a `SYNTHETIC TEST ASSET — NOT A REAL DOCUMENT` banner. No real identity document is used
anywhere in this lane.

| Fixture | Grading mode | What it probes |
|---|---|---|
| `national-id-clean` | strict | Full-field accuracy on a legible document |
| `national-id-rotated` (7°) | strict | Accuracy survives a realistic camera angle |
| `national-id-blurred` (6px) | no fabrication | A degraded document may yield nothing; it may not yield a guess |
| `national-id-glare` | no fabrication | Same, with a specular highlight over the right column |
| `national-id-cropped` (top 50%) | no fabrication + absence pins | `place_of_birth` and `date_of_issue` are **not in the image** and may not come back |
| `passport-clean` | strict | Passport schema |
| `drivers-licence-clean` | strict | Licence schema |
| `registration-book-clean` | strict | Vehicle schema, including a valid 17-character VIN |
| `customs-declaration-clean` | strict | Customs schema, including a decimal duty amount |
| `non-document` | no document | A landscape image must yield zero document fields |
| `unsupported-file.txt` | unsupported | Must be refused before any bytes reach the provider |

`ocr-accuracy-gate.mjs` runs the SHIPPED service over the corpus and grades field by field —
expected, extracted, match type (exact / normalized / missing / incorrect), provider, model,
latency, confidence. **A plausible but wrong value is a FAILURE; a missing value is graded as a
shortfall, not a fabrication.** The gate forces `ALLOW_OCR_MOCK=false` so a measurement can never
be taken against the simulation. Exit codes: `0` PASS, `1` FAIL, `3` NOT_RUN — NOT_RUN is
deliberately non-zero so an unrun gate can never be read as a passed one.

The grading arithmetic is itself unit-tested (`o2-ocr-accuracy-corpus.test.js`), including that a
one-digit difference in an ID number is graded `incorrect` and not a near miss.

## 4. Provider activation — AUTHORIZED, MEASURED, AND BLOCKED ON QUOTA

Product Owner authorization to activate Gemini Vision on staging was granted on 2026-09-04. What
follows is what that authorization actually produced.

### 4.1 Where the credential is, and where it is not

| Location | `GEMINI_API_KEY` | Consequence |
|---|---|---|
| GitHub Actions repository secret | **present** (created 2026-06-05, previously unused by any workflow) | The accuracy gate can run in CI, where the value is injected and never exposed |
| Vercel `carup-backend-staging` — Preview | **absent** | The deployed staging journey cannot reach any provider |
| Vercel `carup-backend-staging` — Production | absent | — |
| Vercel `carup-backend`, `carup-staging`, `carup` | absent | — |

The secret is write-only: GitHub does not return its value, so it cannot be copied into the Vercel
preview environment from here. No credential was printed, committed, written to an artifact or
placed in any frontend environment, and none was fabricated or substituted.

### 4.2 What the live provider actually did

Five runs against real Gemini Vision (`gemini-2.5-flash`, `ALLOW_OCR_MOCK=false`), full history in
[uat-assets/OCR_ACCURACY_RUN_HISTORY.md](uat-assets/OCR_ACCURACY_RUN_HISTORY.md), measured results
in [uat-assets/OCR_ACCURACY_RESULTS.md](uat-assets/OCR_ACCURACY_RESULTS.md).

**Extraction reads the actual pixels, and it reads them correctly.**

- **48 distinct expected fields read correctly; ZERO ever read incorrectly; ZERO fabrications** —
  across every run, on every document class.
- Ten of eleven fixtures have passed on a genuine reading, including all four degraded variants.
  The **cropped** fixture is the sharpest result: the provider read the four fields that survive
  the crop and returned nothing for the two cut off the image, which is precisely the behaviour
  this lane exists to guarantee.
- The **non-document** landscape yielded zero document fields; the **unsupported text file** was
  refused before any byte was uploaded.

**Two defects were found by the live measurement and fixed in-lane:**

1. `national-id-clean` failed after **105 seconds** with an unexplained "malformed response". The
   call was spending its response budget instead of answering. The client now names the real cause
   (`finishReason` / `blockReason` / HTTP status / violated quota, with token usage), bounds the
   call at 90 s, and the OCR request sets an explicit output budget with thinking disabled —
   transcription is not a reasoning task. The same fixture then passed in **2.4 seconds with all
   eight fields exact**.
2. `registration-book-clean` read make, model, year, plate, owner and engine exactly and returned
   no VIN. A registration book prints the chassis number and the VIN once under a combined label,
   so the reading is now carried across — **only** when the value is itself a valid 17-character
   VIN, recorded in `carriedIdentifiers`. Unit-tested; **not yet confirmed live** (see below).

### 4.3 Why the gate has not passed

The credential is on the **Gemini free tier**, and its **daily** request allowance for
`gemini-2.5-flash` is exhausted. The provider names the quota exactly:

```
RESOURCE_EXHAUSTED [quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier]
```

Once that limit is reached, every call is refused in ~170 ms regardless of pacing or backoff — a
single-fixture diagnostic run was refused on all three attempts. This is a **plan limit, not a
provider-quality result**: nothing the provider read was ever wrong.

No expected fixture value was changed, no strictness was reduced, no fuzzy acceptance was
introduced for identity numbers or VINs, and no second provider was substituted.

## 4F. Grader integrity correction — v1 to v2 (2026-09-05, Product Owner authorized)

The Product Owner accepted the LIVE OCR NOT READY verdict of section 4E and authorized ONE narrow
correction: the accuracy grader itself contained a correctness defect. This section records it in
full. No earlier evidence in this receipt was rewritten.

### The defect

Grader v1 inferred ABSTENTION FROM AN EMPTY RESULT without ever asking whether the model had run.
In the absence-checking modes (no_document, no_fabrication) zero extracted fields is a PASS, so a
fixture whose provider call was refused produced zero fields and passed.

That is how run 33936092801 reported PASS 11/11 while the non-document FABRICATION SENTINEL had
never been shown the image: the account's daily neuron allocation ran out mid-run. Provider
unavailability masqueraded as model restraint.

### Exact behaviour before

    provider/model did not execute  +  zero extracted fields  =  PASS   (absence fixtures)

Such a fixture also reported zero fabrications and zero missing, and both fed the overall PASS.

### Exact behaviour after

    NO SUCCESSFUL PROVIDER/MODEL EXECUTION  =  NO ACCURACY PASS

`classifyExecution()` grants an accuracy verdict only on positive evidence that the configured
model ran against the intended image: executionStatus is provider_succeeded, a real provider that
is not mock, a recorded model, provenance showing image bytes and a media type actually sent, a
VERIFIED image transport for that model, no provider error, and a NORMAL completion (finish_reason
not length / content_filter / refusal). HTTP 200 alone proves nothing — Qwen was measured accepting
an ill-formed request with 200 while ignoring the image entirely.

Failing that, the fixture is INCONCLUSIVE: not a pass, its expected fields reported as
`inconclusive` rather than `missing`, contributing NO fabrication or shortfall counts that could
launder into a pass, and forcing the whole corpus to NON-PASS.

Genuine abstention is preserved: a real execution, on the correct transport, with a normal
completion and zero candidate fields still PASSES the sentinel — that is a model declining to
guess, which is exactly what the sentinel exists to detect.

`unsupported-file` is the one exempt mode: its expected outcome IS non-execution (refused before
upload), so requiring a successful execution there would invert the fixture. The exemption is
explicit in the code and pinned by a test.

### Proof the correction reverses the false pass

Re-grading the recorded run 33936092801 offline under v2 — no live calls:

| | Verdict | Fixtures | Inconclusive |
|---|---|---|---|
| v1, as recorded | **PASS** | 11/11 | — |
| v2, replayed | **FAIL** | 9/11 | **2** |

The two named are exactly the ones the model never ran on: `non-document` (quota refusal) and
`national-id-blurred` (no content produced).

### Hashes and immutability proof

| Artefact | Before | After |
|---|---|---|
| `ocrAccuracyGrading.mjs` | `1a4c962167f453124adc5fabe5dd4596a296de90b6c90b3cfd0fdb2994fbb42d` | `bbad11b2c4d0b2e1c174bd981419af39ad8c1d7046461bb514a628a6f3032eeb` |
| `ocr-corpus-manifest.json` | `b48ecadc8f580d3dfc90d70ebc14d523b2700cfb8cfd2a9668c2789309ae6057` | `b48ecadc8f580d3dfc90d70ebc14d523b2700cfb8cfd2a9668c2789309ae6057` (unchanged) |
| 11 corpus fixtures | see below | identical, all eleven |

```
f17a46b9909bb06ad70f592de47616b09b9a1d7a0d8b2760b51fbdc29a719976  customs-declaration-clean.png
9398899e7da0b8ce396e80d5c7fadbf761bb70163c76d8158e09b35d5873f389  drivers-licence-clean.png
46df355ad287ec5549c12ee6372798b64bc447cba736fac45049ac49c76ebc9a  national-id-blurred.png
978f6ac48a570e33479f865e467781e765355ff41b33a62917d96666d2b0b320  national-id-clean.png
175d3aba5e5f1d56a8303596420479e645f638678e9adf49109ccac6e36afff9  national-id-cropped.png
d517aea30916ccfa35554a16d10f1ab21059239d1c81956389fff687e4174b21  national-id-glare.png
8ac50bf8bad9bf5c43d11ba007d3ab91e44cfafbf5d4b9524713a31241dc5497  national-id-rotated.png
83d6ddd2da7ba9827000a585794759ca880e424bd53c64cbcd94a16783e309c3  non-document.png
21c00b534410faab5f327e9f807f4c95d5ede69f3ff211a6ad4ed9bf1fd3aaef  passport-clean.png
ee0ae7863e7077a088d04cff625793c18c96be2f3c6804da1dc8c7a29b7450f1  registration-book-clean.png
d4171785c315d91fd3d6f27b22cf05b0633d6566e3ca35d6937056c9355a7c85  unsupported-file.txt
```

NO expected value, missing-field rule, normalization rule, threshold, prompt or fixture ordering
was changed. The correction only refuses to award a pass it cannot justify — it makes the gate
strictly harder to pass, never easier.

### Regression at the correction head (no live provider calls)

| Gate | Result |
|---|---|
| Full backend suite (repo root, CI env) | **6020 tests · 5999 pass · 0 fail · 21 skipped** |
| `o2-ocr-accuracy-corpus` (grader, +9 new guards) | **23/23** |
| `o2-cloudflare-ocr-provider` | **21/21** |
| `o2-live-ocr-operationalization` | **31/31** |
| X1 authority · X7 guards · 7C identity · mock guard · diaspora route | all green |
| Production build (`tsc -b && vite build`) | **PASS** — 27.58s |
| Lint regression gate vs `71b81d74` | **NET_NEW 0/0** |

**No Cloudflare live calls were made in this task.** The Qwen selection, the Llama rejection and the
Gemma reserve status are unchanged; no staging deploy, no section 3A, no production, no biometrics.

### Governance status of the grader

`ocrAccuracyGrading.mjs` is no longer treated as immutable. It is VERSIONED AND CHANGE-CONTROLLED:
`GRADER_VERSION` is exported, stamped into every result summary and printed in the report header,
and a change requires Product Owner authorization plus a recorded before/after hash and rationale,
as here. Benchmark material — fixtures, answer key, manifest, normalization, thresholds — remains
immutable. A grader may contain bugs; a benchmark that moves to suit a candidate cannot be trusted
at all.

## 4E. Candidate qualification: Qwen 3.8 and Gemma 4 (2026-09-05)

Llama was rejected for fabrication (§4D). Two Cloudflare-hosted vision models were put through the
ordered gates. **No evaluation asset was touched** — the corpus fixtures, answer key, manifest,
normalization and grading each have exactly one commit in their entire history (`cf5b71a8`),
verified by `git log` and SHA-256 before any benchmarking began.

### Models and outcomes

| Workers AI model id | Gate 0 abstention | Gate 1 clean National ID | Gate 2 full corpus | Disposition |
|---|---|---|---|---|
| `@cf/meta/llama-3.2-11b-vision-instruct` | **FAIL** — 8 fabricated fields, confidence 1 | — | — | **REJECTED — FABRICATION.** Blocked in code; cannot be selected by configuration |
| `@cf/qwen/qwen3.8-27b` | **PASS** — zero fields, correct abstention | **PASS** — 8/8 exact, confidence 0.99 | 9/11 read genuinely, **not certifiable** | Leading candidate, **unproven** |
| `@cf/google/gemma-4-26b-a4b-it` | **PASS** — zero fields, correct abstention | 8/8 in the schema probe | not reached | Reserve candidate |

### The adapter defect both candidates exposed — and the repair

Both models initially failed Gate 1 by declaring `date_of_birth`, `country` and `date_of_issue`
**unreadable** — values printed in 25px bold. Two unrelated model families failing identically
pointed at CarUp's request rather than at their eyesight. A bounded probe held image and prompt
constant and varied only the schema:

| Model | with `response_format` | without |
|---|---|---|
| Gemma 4 | 5/8 (3 declared unreadable) | **8/8, every value correct** |
| Qwen 3.8 | 4/8 | **8/8, every value correct** |

CarUp's own request was destroying four correct readings per document. Cloudflare's JSON Mode page
states enforcement is best-effort and lists neither model. `response_format` is now withheld
per-transport with the measurement recorded and a permanent guard; structure comes from the
absolute output-format instruction plus fail-closed JSON-object recovery, neither of which infers
anything from prose. Gate 1 then passed 8/8. **Only the request changed.**

### A silent-image trap, caught before it could certify anything

`@cf/qwen/qwen3.8-27b` accepts Llama's top-level `image` field with HTTP 200 and **silently ignores
it** — prompt_tokens identical to a request carrying no image (106 vs 106), versus 172 for the
OpenAI content-part form, which the model then answered correctly. Both candidates also answer at
`result.choices[0].message.content`, not `result.response`. A naive port of Llama's shape would have
produced an "extraction" that never saw the document while returning 200 — the precise failure this
lane exists to eliminate. Transports are now bound per model and an unprobed model is refused.

### Gate 2 — reported PASS, not a certification

[Run 33936092801](https://github.com/kudzimusar/carup/actions/runs/33936092801) reported
`PASS · 11/11 · 0 fabrications · 45 exact · 0 normalized · 6 missing · 0 incorrect`.

Nine fixtures earned it. Two did not:

- **`non-document`**, the fabrication safety sentinel, was refused mid-run — *"you have used up your
  daily free allocation of 10,000 neurons"*. Zero fields came back because the model never saw the
  image, and `no_document` mode reads zero fields as PASS.
- **`national-id-blurred`** returned no content in three attempts, and `no_fabrication` accepts
  missing.

Absence caused by provider unavailability is not a model declining to guess. Qwen did pass the
sentinel genuinely earlier ([run 33935029777](https://github.com/kudzimusar/carup/actions/runs/33935029777),
156.75 neurons, zero fields) — but **before** the `response_format` repair, and that repair made
both models markedly more forthcoming, which is exactly what could change abstention behaviour. The
sentinel must be re-run under the shipping configuration.

**This lane therefore does not count Gate 2 as passed, and staging deployment and §3A were not
started.** A fail-closed outcome is not an OCR success.

### Hard external blocker

The Cloudflare account's **daily free allocation of 10,000 neurons is exhausted**, confirmed
directly against both candidate models after the run. Qwen costs ~180–530 neurons per document; one
full corpus run is ~2,500–3,000 before retries. To finish: raise the Workers AI allocation (Workers
Paid), then re-run Gate 0 → Gate 1 → Gate 2 unchanged, and only then staging + §3A.

### Regression matrix at the qualification head

| Gate | Result |
|---|---|
| Full backend suite (repo root, CI env) | **6010 tests · 5989 pass · 0 fail · 21 skipped** |
| `o2-cloudflare-ocr-provider` | **21/21** (5 new guards this round) |
| `o2-live-ocr-operationalization` | **31/31** |
| `o2-ocr-accuracy-corpus` | **13/13** |
| X1 authority · X2 journey · X3 lifecycle · X7 guards | 6/6 · 13/13 · 7/7 · 13/13 |
| 7C identity (`verification-*`) | 15/15 · 4/4 · 5/5 |
| `ocr-mock-guard` · `diaspora-ocr-route` | 3/3 · 13/13 |
| `non-seller-authority-hardening` · `issue164-phase3-trust-authority` | 8/8 · 57/57 |
| Production build (`tsc -b && vite build`) | **PASS** — 55.82s |
| Lint regression gate vs `71b81d74` | **NET_NEW 0/0** |

The web suite was not re-run: no web code was touched this round (the change surface is the
Cloudflare client, the provider boundary, the document schemas, backend tests, the gate tool and
two workflows), and the production build compiles the whole frontend.

### Permanent guards added this round

- the REJECTED Llama model cannot be selected by configuration, and the refusal names the reason;
- a model with no PROVEN transport is refused rather than guessed at;
- each model uses the image form measured to deliver its pixels — Qwen must never be sent the
  top-level `image` field it silently ignores;
- each model is read from the envelope it actually answers in, and reading Qwen with Llama's
  envelope yields nothing rather than a false empty;
- `response_format` is withheld from the models it demonstrably harms, with the 5/8-vs-8/8 and
  4/8-vs-8/8 measurements recorded beside the guard.

### Recommendation, deliberately not applied

The gate cannot distinguish "the model abstained" from "the provider never answered" — for
`no_document` and `no_fabrication` fixtures both present as zero fields. A fixture whose provider
call failed should grade **INCONCLUSIVE** and fail the gate. That is a strengthening, but
`ocrAccuracyGrading.mjs` is on the immutable list, so it is recorded as a Product Owner decision
rather than changed unilaterally.

## 4D. Provider change: Cloudflare Workers AI (2026-09-05) — NOT READY, on fabrication

Gemini's paid tier was unavailable, so the Product Owner authorized Cloudflare Workers AI
(`@cf/meta/llama-3.2-11b-vision-instruct`) as the replacement candidate and supplied credentials in
both GitHub Actions and the branch-scoped Vercel Preview.

### What was built

Cloudflare sits **behind the existing OCR provider boundary**. Document Intelligence was not
redesigned: it still observes, and the domain authorities still decide. It now asks
`ocrVisionProvider.js` for "the configured vision provider" rather than naming a client.

- Selection is `CARUP_OCR_PROVIDER` and nothing else. There is **no automatic fallback** — pinned
  by a guard — so a reading is never attributed to a model that was never asked.
- Gemini remains implemented and selectable, is not the default, and was not used here.
- The response schema is **derived from CarUp's existing document schemas**, so the two cannot
  drift; a guard asserts the requested properties equal the schema's fields exactly. No document
  field is ever `required`, because a required field invites invention.
- Provenance now carries provider, model, execution status, requested and observed document class,
  latency, media facts, and Workers AI's **own reported usage** (neurons and tokens) — `null` when
  the provider reports none, never estimated.

### The two integration issues from the manual test, fixed where they belong

**`first_name` vs "Given names".** No new convention was introduced: `first_name` is still the
field. The prompt now names both CarUp's field and the wording printed on the document, and
`FIELD_ALIASES` accepts synonyms **for the same printed field**. Fields the schemas deliberately
keep apart — plate vs registration number, VIN vs book number, tax vs company number — share no
alias, which is pinned by a guard.

**Prose around JSON.** Measured, not assumed: the bare `prompt` form makes this model answer in
prose; the `messages` form makes Workers AI return a parsed object. `response_format` and
`guided_json` are **accepted by the API but not enforced on this model** — a schema asking for
`colour` came back as `dominant_colour`. The schema is still sent; it is simply not trusted.

### The ordered first gate PASSED

One unchanged clean National-ID fixture through the real provider
([run 33930917859](https://github.com/kudzimusar/carup/actions/runs/33930917859)):
**8 expected fields, 8 exact, 0 missing, 0 incorrect**, 6.7 s, confidence 1, 38.21 neurons — against
the existing answer key, with no change to the fixture, manifest, normalization or grading.

`registration-book-clean` also passed live: **all seven fields exact, including the VIN.**

### The full corpus FAILS — and the reason is fabrication

[Run 33931341267](https://github.com/kudzimusar/carup/actions/runs/33931341267): **7/11 fixtures,
27 exact, 3 normalized, 21 missing, 8 INCORRECT, 8 FABRICATIONS.**

Shown `non-document` — a rendered landscape photograph with no text and no document — the model
returned a complete invented Zimbabwean identity: `Tendai Makore`, `65-123456-7`, `1990-01-01`,
`Zimbabwe`, `Harare`, `M`, `2010-01-01`, with `legible: true`, **confidence 1**, and extraction
status `Pending_Verification`.

Reproduced across both full-corpus runs and three isolated prompt variants — including one with
every example value removed from the prompt, and one stating explicitly that an empty result is
correct and a wrong value far worse than none — at `temperature: 0`. In an early probe the model
returned the prompt's own example identity number as though it had read it, which is why no example
value remains in any prompt.

**Prompt engineering does not fix this. It is a measured property of the model.**

A second defect: JSON output is unreliable and non-deterministic. `national-id-clean` scored 8/8
exact in one run and produced no recoverable JSON at all in the next.

### Regression matrix at the Cloudflare head

Product code changed, so the guards were re-run even though the ordered sequence stopped.

| Gate | Result |
|---|---|
| Full backend suite (repo root, CI env) | **6005 tests · 5982 pass · 2 fail · 21 skipped** |
| — the 2 failures | `fraud-routes.test.js`, a port collision in the full run (`Unexpected token 'W', "WebSockets"`). **12/12 in isolation**, zero OCR references, byte-identical to the lane base — environmental, not a regression |
| `o2-cloudflare-ocr-provider` (new) | **16/16** |
| `o2-live-ocr-operationalization` | **31/31** |
| `o2-ocr-accuracy-corpus` | **13/13** |
| X1 authority · X2 journey · X3 lifecycle · X7 guards | 6/6 · 13/13 · 7/7 · 13/13 |
| 7C identity (`verification-*`) | 15/15 · 4/4 · 5/5 |
| `ocr-mock-guard` · `diaspora-ocr-route` | 3/3 · 13/13 |
| `non-seller-authority-hardening` · `issue164-phase3-trust-authority` | 8/8 · 57/57 |
| Production build (`tsc -b && vite build`) | **PASS** — 25.48s |
| Lint regression gate vs `71b81d74` | **NET_NEW 0/0** |

The web suite was not re-run: no web code was touched in this lane step (the change surface is
backend services, backend tests, the gate tool and the workflow), and the production build — which
compiles the whole frontend — passes.

### Why the sequence stopped here

The corpus did not pass, so staging deployment and §3A were **not** run. Putting a provider that
invents identities from photographs in front of an identity-verification UAT would manufacture
exactly the false evidence this programme exists to prevent.

Nothing was weakened to accommodate the result: the corpus, answer key, normalization and grading
are untouched, and CarUp's own guards caught the fabrication, graded it `incorrect`, and failed the
gate — which is the system working.

## 4C. Second activation attempt — the quota measured exactly (2026-09-04, 16:00–16:25 UTC)

Reported as: paid Gemini project/key configured in both GitHub Actions and the branch-scoped Vercel
Preview. Measured result: **neither credential is on a billed project.**

### Availability is now proven by a request, not by a variable

The gate makes one real `generateContent` call before measuring anything. It was refused:

```
HTTP 429  RESOURCE_EXHAUSTED
"Quota exceeded for metric:
   generativelanguage.googleapis.com/generate_content_free_tier_requests,
 limit: 20, model: gemini-2.5-flash"

quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier   quotaValue: 20
```

**Twenty requests per day**, metered against a metric literally named
`generate_content_free_tier_requests`. A billed project is metered against the paid metric, so this
is direct evidence of no active billing on the project issuing this key. The corpus needs eleven
calls, so a single day's allowance cannot even cover two gate runs.

### Neither credential was replaced

| Credential | Last changed | How that was established |
|---|---|---|
| GitHub Actions secret | **2026-06-05T05:06:54Z** | `gh secret list --json updatedAt` — untouched for three months |
| Vercel `carup-backend-staging` Preview (branch-scoped) | **2026-09-04T13:25:21Z** | Vercel API: `createdAt == updatedAt`, i.e. the key set in the previous session |

Enabling billing does not change a key's value, so timestamps alone would not disprove activation —
but the provider's free-tier metering of *both* credentials does.

### What did change for the better

The §3A journey got further than before: **evidence classification SUCCEEDED**
(`likely_identity_document`), which is the first live proof that the deployed classification path
reaches Gemini and returns a real verdict. The OCR call immediately after it was refused by the same
free-tier daily quota — recorded verbatim in `ocr_documents.ocr_err_5007e3ed88`:

```
Gemini vision returned no text: RESOURCE_EXHAUSTED
  [quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier]
```

Session outcome: `ocr_execution_status: provider_failed`, `extraction_trust_status: no_fields`,
`primary_reason_code: OCR_PROVIDER_FAILED`, `confidence_score: null`, eight expected fields
**8 MISSING / 0 INCORRECT / 0 fabricated**, identity **not** verified. Honest in failure, again.

And in gate run 9 the one fixture that got a request through — `national-id-rotated` — was read
completely: all four expected fields **exact**, confidence 1.

### To close

Put a key from the **billing-enabled** project into both places — Vercel `carup-backend-staging`
→ Preview (branch `fix/o2-live-ocr-operationalization`) **and** the GitHub Actions repository
secret — then confirm with the gate's own proof step, which now prints the exact quota on refusal.
The correct signal to look for is the proof step printing
`PROOF: a real vision request SUCCEEDED with no quota refusal.`

Nothing else is outstanding: the exact-head pair is live and proven, the journey works end to end,
and the extraction code is measured correct wherever quota has allowed a reading.

## 4B. Staging activation attempt — exact-head pair proven, provider quota not

*2026-09-04, after the Product Owner enabled billing and configured `GEMINI_API_KEY` on Vercel
`carup-backend-staging` Preview for this branch.*

### What was completed

**The exact-head staging pair is live and proven.** Both pairing maps gained an additive entry for
this lane, using the Vercel API's reported `meta.branchAlias` rather than a guessed hostname, and
no existing O2 / #194 / Seller candidate was displaced.

| Proof | Value |
|---|---|
| Frontend | `carup-staging-git-fix-o2-live-ocr-operationalization-11-11.vercel.app` |
| Backend | `carup-backend-staging-git-fix-o2-live-ocr-operatio-5cedc4-11-11.vercel.app` |
| `frontend_sha` | `f67589c3cec77e8efd7b345313843f11799c3015` |
| `backend_sha` | `f67589c3cec77e8efd7b345313843f11799c3015` |
| `unpaired` | `false` |
| `api_base_source` | `paired from preview-backend-pairing.json for "fix/o2-live-ocr-operationalization"` |

The backend at the pre-activation SHA reported `ocrProviders.gemini: false` because it had been
built before the variable existed; redeploying the **same commit** picked the variable up without
moving the candidate.

### What blocked it

`ocrProviders.gemini: true` proves only that the environment variable is non-empty. Proving the
provider is *available* requires a real call, and every real call was refused:

```
RESOURCE_EXHAUSTED [quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier]
```

- **The GitHub Actions repository secret** (used by the accuracy gate) — refused in runs 6 and 7.
- **The Vercel staging Preview key** (used by the deployed journey) — refused during §3A, with the
  identical quota id.

Both credentials CarUp uses are on free-tier projects whose daily allowance is spent. Billing
appears to have been enabled on a Google Cloud project other than the one issuing these keys, or
the keys were not replaced with billed ones.

### §3A on the deployed pair — measured, and honest in failure

Synthetic account `o2.liveocr.c9af006a@carup-staging.test`, session
`120e718b-22a4-4e2a-b924-30bf13ffccf3`, real synthetic pixels uploaded through the real journey.

Eight expected fields: **8 MISSING, 0 INCORRECT, 0 fabricated.** Extraction never ran, so §3A does
not pass. Everything the product *did* do was correct:

- the failure reason names the real provider cause verbatim, including the violated quota id —
  the diagnostics this lane added, working in production;
- `ocr_execution_status`, `ocr_document_id`, `ocr_result`, `confidence_score` are all `null`
  rather than defaulted;
- `identity.state: in_review`, `lifecycle.effective_state: not_established`,
  `capability_bearing: false`; assurance `pending`, `usable_for_identity_gated_actions: false`;
- candidates `available: false` with an honest reason;
- routed to `pending_manual_review` with `reviewer_id: null` — the governed reviewer remains the
  only identity decision writer;
- no blur, glare or tampering score anywhere.

A correct product guard also fired en route: uploading the same image as front and back was
refused with `FRONT_BACK_DUPLICATE`. That was a flaw in the first attempt's fixtures, not in the
product; the run was repeated with the distinct synthetic back and selfie.

**Manual-review fallback is not an OCR pass, and is not recorded as one.**

### To close

Point `GEMINI_API_KEY` at a key belonging to the billing-enabled project in **both** places —
Vercel `carup-backend-staging` → Preview, **and** the GitHub Actions repository secret — then
re-run the full accuracy gate and §3A. Nothing else is outstanding.

## 4A. Provider-activation boundary as recorded BEFORE authorization (superseded by §4)

*Kept as written on 2026-09-04, before the Product Owner granted activation. Superseded by §4
above; recorded rather than rewritten.*

No credential was placed in the repository, in any log, or in any deployment. Nothing was
activated in production, and no O2 staging gate was mutated.

The gate's plumbing was smoke-tested end to end with a deliberately invalid key, which exercised
all eleven fixtures, the real provider call path and the grading: 0 fabrications, 37 shortfalls,
verdict FAIL — the correct result when the provider rejects the request. That proves the harness
runs; it measures nothing about extraction accuracy, and is not reported as an accuracy result.

~~**The accuracy gate has NOT been run against a live provider.**~~ **Superseded:** it has now
been run five times against real Gemini Vision — see §4.2. The statement that no provider is
configured for CarUp staging **still holds for the deployed backend**: the credential exists only
as a GitHub Actions secret, not in the Vercel preview environment.

## 5. Verification

Live measurement required code changes after `92aaed8b`, so the whole matrix was re-run at the
current head. Both runs are recorded; the second supersedes the first.

| Gate | At `92aaed8b` (pre-activation) | At `107cb5b0` (after the live fixes) |
|---|---|---|
| **Full backend suite** (`node --test backend/tests/*.test.js` from repo root, CI env) | 5986 tests · 5965 pass · 0 fail · 21 skipped | **5988 tests · 5967 pass · 0 fail · 21 skipped · exit 0** |
| **Full web suite** (`vitest run`) | 164 files · 1585 pass · 0 fail | **164 files · 1585 tests · 1585 pass · 0 fail · exit 0** |
| **TypeScript + production build** (`npm run build` = `tsc -b && vite build`) | PASS (31.31s) | **PASS** — built in 25.47s |
| **Lint regression gate** (`scripts/lint-baseline-gate.mjs` vs `71b81d74`) | NET_NEW 0/0 | **NET_NEW_ERRORS=0 · NET_NEW_WARNINGS=0 · exit 0** (advisory inventory unchanged at 135/9) |
| **OCR accuracy gate (live Gemini Vision)** | NOT RUN — no provider authorized | **FAIL — 0 fabrications, 0 incorrect; blocked by the free-tier DAILY quota** (see §4) |

Named suites re-run individually:

| Suite | Result |
|---|---|
| `o2-x1-document-intelligence-authority` (the X1 boundary) | 6/6 |
| `o2-x2-registration-journey` · `o2-x2-registration-routes` | 13/13 · 9/9 |
| `o2-x3-identity-lifecycle` | 7/7 |
| `o2-x7-integrated-certification` (authority guards) | 13/13 |
| `verification-session-workflow` · `verification-ocr-provenance` · `verification-terminal-and-consistency` (7C identity) | 15/15 · 4/4 · 5/5 |
| `ocr-mock-guard` · `diaspora-ocr-route` | 3/3 · 13/13 |
| `non-seller-authority-hardening` · `issue164-phase3-trust-authority` | 8/8 · 57/57 |
| **`o2-live-ocr-operationalization`** (new) | **28/28** |
| **`o2-ocr-accuracy-corpus`** (new) | **13/13** |

### A measurement note worth recording

The first two full web runs reported failures — one test at 897 s, another at 138 s. Re-running
the first file in isolation gave **6/6 pass with 214 ms of test time and 596 s of module import**.
The machine was thrashing (swap 6.3 GB of 7.1 GB; ~16 MB free RAM), so the "failures" were the
default 5 s timeout firing on I/O starvation, not defects. The clean run above was taken with two
workers and a starvation-tolerant timeout; assertion failures are unaffected by that timeout, so
nothing is masked by it. Recorded because a contended run must never be read as a certification
result — in either direction.

## 6. The 41 new permanent guards

`o2-live-ocr-operationalization.test.js` (28) pins, against the SHIPPED service with a captured
provider: the document bytes are sent complete and unmodified as an image part; the truncated-text
path cannot return; unread fields are absent rather than defaulted; an incomplete reading writes no
structured row while a complete one does; an identity number is never reused as a plate number or a
bill of entry; quality is `not_measured` with only header-readable media facts; an unreported,
out-of-range or non-numeric confidence is discarded; the identity gate no longer substitutes a blur
score; a provider that is unconfigured, that errors, or that returns malformed output fails as a
provider failure with no fields; a provider that answered but read nothing is distinct from that;
an unsupported file is refused before any byte is uploaded; provenance is complete; each document
class uses its own schema; non-normalizable values are kept as observations rather than coerced;
absence spellings are read as absence; writes stay confined to the OCR evidence tables; a candidate
still needs the user and a governed reviewer; the test seam cannot become a production bypass; no
document bytes reach the logs or the evidence row; and test-mode simulation is labelled as
simulated and is unreachable once a key is configured.

`o2-ocr-accuracy-corpus.test.js` (13) pins the corpus and the grading: every fixture exists and is
a real PNG; every expected field is one the schema can produce; **every expected value is genuinely
printed on that fixture** (each is re-derived from the layout through the same normalizers); a
one-digit difference is `incorrect`, not a near miss; missing is a shortfall on a clean fixture and
acceptable on a degraded one, while guessing at a degraded field is still a fabrication; a cropped-
out field may not come back; any field read off a non-document fails; an unsupported file must be
refused before the provider; and the gate reports NOT_RUN with a non-zero exit when no provider is
authorized, so it can never be read as a pass.

## 7. Verdict

**GATE INTEGRITY FIX APPLIED (section 4F); LIVE OCR still NOT READY — Qwen 3.8 is the leading candidate and reads accurately (45 exact, 0 incorrect, 0 fabrications across 9 genuinely-read fixtures), but the fabrication safety sentinel was graded on a provider outage rather than a model abstention, and the Cloudflare daily neuron allocation is exhausted so it cannot be re-run. See §4E. Llama remains REJECTED for fabrication (§4D).**

*(Superseded the Gemini quota verdict of §4C: the provider changed, and so did the blocker — from "the credential cannot serve requests" to "the model invents readings".)*

*(Superseded the earlier `LIVE OCR CODE READY — STAGING PROVIDER AUTHORIZATION REQUIRED`:
authorization was granted, the staging pair was built and proven, and the remaining blocker moved
from "no credential" to "the credential cannot serve requests". See §4B.)*

The extraction path is genuinely image-based and production-honest, the four fabrications are gone
and pinned against return, and the certified candidate → confirmation → governed-decision boundary
is intact. What remains is not code:

1. Product Owner authorization to configure an OCR/vision provider credential for CarUp **staging**
   (staging only; production stays untouched, and no credential enters the repository).
2. Run `node backend/tests/tools/ocr-accuracy-gate.mjs` with that credential and attach
   `OCR_ACCURACY_RESULTS.md`.
3. Re-run the §3A Live OCR Operational Check on the exact-head staging pair, where
   **manual-review fallback does not count as an OCR PASS**.

Until (1)–(3) are done, §3A of the Owner UAT pack stays **NOT READY**, and this lane is not
merged.

**Updated after the activation attempt (§4B):** steps (1) and (3) were performed. The staging pair
is live and proven at `f67589c3`, and §3A was executed through the deployed journey. Step (2), the
accuracy gate, and §3A all remain blocked on the same thing — a Gemini key that is actually on the
billed project. The extraction code itself is measured correct: 48 fields read correctly across
every run that had quota, and **not one field ever read incorrectly**.
