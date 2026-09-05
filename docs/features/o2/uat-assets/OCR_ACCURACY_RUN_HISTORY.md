# Live OCR accuracy — run history against real Gemini Vision

Every run below used the REAL provider (`gemini-2.5-flash`) with `ALLOW_OCR_MOCK=false`, inside
GitHub Actions, where the credential lives. The credential never left CI: it is a repository
secret, injected as an env var, and appears nowhere in this repository, these artifacts or any log.

| # | Run | Candidate | Verdict | Fixtures | Exact | **Incorrect** | Fabrications |
|---|---|---|---|---|---|---|---|
| 1 | [33871537524](https://github.com/kudzimusar/carup/actions/runs/33871537524) | `3dfa48b4` | FAIL | 9/11 | 40 | **0** | 0 |
| 2 | [33872304150](https://github.com/kudzimusar/carup/actions/runs/33872304150) | `37446cab` | FAIL | 8/11 | 31 | **0** | 0 |
| 3 | [33872499074](https://github.com/kudzimusar/carup/actions/runs/33872499074) | `aac77d11` | FAIL | 9/11 | 36 | **0** | 0 |
| 4 | [33873117569](https://github.com/kudzimusar/carup/actions/runs/33873117569) | `fc63f630` | FAIL | 6/11 | 8 | **0** | 0 |
| 5 | [33874950788](https://github.com/kudzimusar/carup/actions/runs/33874950788) | `107cb5b0` | PARTIAL (1 fixture) | 0/1 | 0 | **0** | 0 |
| 6 | [33878492890](https://github.com/kudzimusar/carup/actions/runs/33878492890) | `8659f67a` | FAIL | — | 0 | **0** | 0 |
| 7 | [33880682676](https://github.com/kudzimusar/carup/actions/runs/33880682676) | `8659f67a` | PARTIAL (1 fixture) | 0/1 | 0 | **0** | 0 |

**Across every run, not one field was ever read incorrectly, and nothing was ever fabricated.**
48 distinct expected fields were read correctly at least once. The variation in the `Exact` column
tracks how much provider quota was left, not reading quality.

## Per-fixture coverage

`PASS`/`fail` = the provider answered and the fixture was graded. `quota` = the provider refused
with `RESOURCE_EXHAUSTED` and never saw the image.

| Fixture | run 1 | run 2 | run 3 | run 4 | run 5 |
|---|---|---|---|---|---|
| national-id-clean | quota | **PASS** | **PASS** | **PASS** | — |
| national-id-rotated | **PASS** | **PASS** | **PASS** | quota | — |
| national-id-blurred | **PASS** | **PASS** | **PASS** | quota | — |
| national-id-glare | **PASS** | **PASS** | **PASS** | quota | — |
| national-id-cropped | **PASS** | **PASS** | **PASS** | quota | — |
| passport-clean | **PASS** | **PASS** | **PASS** | quota | — |
| drivers-licence-clean | **PASS** | quota | **PASS** | quota | — |
| registration-book-clean | fail (VIN) | quota | quota | quota | quota |
| customs-declaration-clean | **PASS** | quota | quota | quota | — |
| non-document | **PASS** | quota | quota | quota | — |
| unsupported-file | **PASS** | **PASS** | **PASS** | **PASS** | — |

Ten of the eleven fixtures have passed on a genuine provider reading. **This is coverage across
runs, not a gate pass** — the gate passes only when one run measures the whole corpus cleanly, and
no run has yet been allowed to.

## What each run established

**Run 1** — the first live measurement. Nine fixtures passed, including every degraded variant.
Two failures: `national-id-clean` failed after 105 s with a generic "malformed response", and
`registration-book-clean` read make, model, year, plate, owner and engine exactly but returned no
VIN.

**Run 2** — after bounding the request (90 s timeout, explicit output budget, thinking disabled)
and naming the real failure cause, `national-id-clean` went from a 105-second failure to a
**2.4-second pass with all eight fields exact**. The 105 s call had been spending its response
budget rather than answering. Fixtures 7–10 were then refused: `RESOURCE_EXHAUSTED`.

**Run 3** — with the corpus paced, eight fixtures read at confidence 1. The quota refusals moved
later in the corpus but did not stop.

**Run 4** — the error now names the violated quota: **`GenerateRequestsPerDayPerProjectPerModel-FreeTier`**.
The credential is on the Gemini **free tier** and its **daily** allowance for `gemini-2.5-flash`
is spent. No pacing or backoff can recover a daily quota.

**Run 5** — a single-fixture diagnostic to re-measure `registration-book-clean` after the
chassis/VIN fix. All three attempts were refused by the same daily quota, so **the VIN fix remains
unverified against the live provider.**

## The one open measurement

`registration-book-clean` is the only fixture never yet passed. Its single real reading (run 1,
before the fix) returned every other field exactly and omitted only the VIN. A registration book
prints the chassis number and the VIN once under a combined label, so the candidate now carries
that reading across — but **only** when the value is itself a valid 17-character VIN, and the
carry is recorded in `carriedIdentifiers`. That fix is covered by unit regression tests and is
waiting on quota to be confirmed live.


## Runs 6 and 7 — after Product Owner billing activation (2026-09-04)

Billing was enabled and `GEMINI_API_KEY` was configured on Vercel `carup-backend-staging` Preview.
Runs 6 and 7 re-tested the **GitHub Actions** credential the gate uses, and both were refused with
the identical quota:

```
RESOURCE_EXHAUSTED [quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier]
```

The repository secret is therefore still a free-tier key with its daily allowance spent.

The staging credential was tested separately and independently, through the deployed §3A journey
on the exact-head pair. It was refused with the **same** quota id. Both credentials CarUp uses are
free-tier and exhausted; billing appears to be enabled on a Google Cloud project other than the one
issuing these keys.

`/api/health` reporting `ocrProviders.gemini: true` proves only that the environment variable is
non-empty. It is not evidence that the provider will serve a request.


## Runs 8 and 9 — the quota, measured exactly (2026-09-04)

A single real `generateContent` call now runs before the gate, so provider availability is proven
by a request rather than inferred. It was refused, and printed Google's full quota block:

```
HTTP 429  RESOURCE_EXHAUSTED
"Quota exceeded for metric:
   generativelanguage.googleapis.com/generate_content_free_tier_requests,
 limit: 20, model: gemini-2.5-flash"

quotaId:     GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaValue:  20
dimensions:  { location: global, model: gemini-2.5-flash }
```

**Twenty requests per day**, metered against the metric literally named
`generate_content_free_tier_requests`. A project with active billing is metered against the paid
metric, so this is direct evidence that the project issuing this key has **no active billing**.
The eleven-fixture corpus alone needs eleven calls, so two runs exhaust a whole day.

### Neither credential was replaced

| Credential | Last changed | Evidence |
|---|---|---|
| GitHub Actions secret `GEMINI_API_KEY` | **2026-06-05T05:06:54Z** | `gh secret list` — three months old, untouched |
| Vercel `carup-backend-staging` Preview `GEMINI_API_KEY` | **2026-09-04T13:25:21Z** | Vercel API `createdAt == updatedAt` — the key configured in the previous session, unchanged since |

Enabling billing on a Google Cloud project does not change an API key's value, so an unchanged
timestamp would not by itself disprove activation. The provider's own free-tier metering does: both
credentials are still metered as free tier.

### What run 9 nevertheless showed

`national-id-rotated` was read completely — all four expected fields **exact**, confidence 1 — in
the one window where a request was allowed. Across runs 8 and 9: **4 exact, 0 incorrect, 0
fabrications.** Every refusal was recorded as a provider failure with no fields, never as a reading.

---

# Provider change: Cloudflare Workers AI (2026-09-05)

Gemini's paid tier was unavailable, so the Product Owner authorized Cloudflare Workers AI
(`@cf/meta/llama-3.2-11b-vision-instruct`) as the replacement candidate. The corpus, its answer
key, normalization and grading were **not** changed.

| # | Run | Candidate | Scope | Verdict | Exact | **Incorrect** | Fabrications |
|---|---|---|---|---|---|---|---|
| 10 | [33930707171](https://github.com/kudzimusar/carup/actions/runs/33930707171) | `b1986f70` | 1 fixture | PARTIAL | 0 | 0 | 0 |
| 11 | [33930917859](https://github.com/kudzimusar/carup/actions/runs/33930917859) | `a2aeccef` | 1 fixture (`national-id-clean`) | **PARTIAL — 8/8 exact** | 8 | **0** | 0 |
| 12 | [33930992334](https://github.com/kudzimusar/carup/actions/runs/33930992334) | `a2aeccef` | full 11 | **FAIL** | 26 | **8** | **8** |
| 13 | [33931341267](https://github.com/kudzimusar/carup/actions/runs/33931341267) | `14013f9f` | full 11 | **FAIL** | 27 | **8** | **8** |

## The ordered first gate passed

Run 11 put one unchanged clean National-ID fixture through the real provider and it passed the
existing answer key outright: **8 fields expected, 8 exact, 0 missing, 0 incorrect**, 6.7 s,
confidence 1, 38.21 neurons. Nothing in the fixture, manifest, normalization or grading moved.

`registration-book-clean` also passed live in run 13 — **all seven fields exact, including
`vin: JTDBR32E870123456`**. The VIN/chassis carry path was not needed on this reading because the
model populated `vin` directly (`carriedIdentifiers: []`); the fix remains covered by unit guards.

## Why the full corpus FAILS: the model fabricates

`non-document` is a rendered landscape photograph — sky, sun, two hills, no text and no document.
Shown that image and asked for a Zimbabwe National Registration card, the model returned:

| Field | Value it returned | Actually in the image |
|---|---|---|
| first_name | `Tendai` | nothing |
| last_name | `Makore` | nothing |
| national_id_number | `65-123456-7` | nothing |
| date_of_birth | `1990-01-01` | nothing |
| country | `Zimbabwe` | nothing |
| place_of_birth | `Harare` | nothing |
| sex | `M` | nothing |
| date_of_issue | `2010-01-01` | nothing |

`legible: true`, `confidence: 1`, extraction status `Pending_Verification`. **Eight fabricated
fields presented as a confident reading of a photograph of a hillside.**

This reproduced across both full-corpus runs and, in isolated probing, across three prompt
variants — including one that removed every example value from the prompt and one that stated
explicitly that an empty result is correct and that a wrong value is far worse than no value. At
`temperature: 0`. In an early probe the model even returned the prompt's own example identity
number `63-1234567-A-42` as though it had read it, which is why no example value remains in any
prompt.

**Prompt engineering did not fix it.** This is a property of the model, measured, not a defect in
the adapter.

## Second measured defect: unreliable JSON

Even with an absolute output-format instruction and a `response_format` json_schema, this model
wraps its JSON in prose on a large minority of calls. `response_format` and `guided_json` are
**accepted by the Workers AI API but not enforced** on this model — a schema asking for `colour`
came back as `dominant_colour`. A fail-closed recovery of a single balanced JSON object was added
(nothing is inferred from the prose), and even so two fixtures in run 13 exhausted all three
attempts with output that contained no recoverable JSON at all.

The runs are also non-deterministic at `temperature: 0`: `national-id-clean` scored 8/8 exact in
run 11 and produced no usable output at all in run 13.

## Verdict

The corpus did not pass, so the ordered sequence stopped here. Staging deployment and the §3A
journey were **not** run: putting a provider that invents identities from photographs in front of
an identity-verification UAT would manufacture exactly the false evidence this programme exists to
prevent.

CarUp's own guards behaved correctly throughout — the fabrication was caught by the corpus, graded
`incorrect`, and failed the gate. Nothing was weakened to accommodate it.

---

# Candidate qualification round: Qwen 3.8 and Gemma 4 (2026-09-05)

Llama was rejected for fabrication (see the previous section). Two Cloudflare-hosted vision models
were put through the ordered gates. **The corpus, fixture pixels, answer key, manifest,
normalization and grading were not touched** — each has exactly one commit in its entire history,
`cf5b71a8`, verified by `git log` and SHA-256 before benchmarking.

## Model IDs and outcomes

| Model | Gate 0 (abstention) | Gate 1 (clean National ID) | Gate 2 (full corpus) | Status |
|---|---|---|---|---|
| `@cf/meta/llama-3.2-11b-vision-instruct` | **FAIL** — 8 fabricated fields at confidence 1 | (8/8 when clean) | FAIL | **REJECTED — FABRICATION**, blocked in code |
| `@cf/qwen/qwen3.8-27b` | **PASS** — 0 fields, correct abstention | **PASS** — 8/8 exact after the adapter repair | 9/11 read genuinely; **NOT CERTIFIABLE** | Candidate, unproven |
| `@cf/google/gemma-4-26b-a4b-it` | **PASS** — 0 fields, correct abstention | 5/8 before the repair; 8/8 in the schema probe | not reached (Qwen was ordered first) | Untested at Gate 2 |

## The adapter defect both models exposed

Gate 1 initially failed for both candidates in the same odd way: each declared `date_of_birth`,
`country` and `date_of_issue` **unreadable** — values printed in 25px bold. Two different model
families independently "failing" on exactly the same fields pointed at CarUp's request, not at
their eyesight.

A bounded probe held the image and prompt constant and varied only the requested schema:

| Model | with `response_format` | without `response_format` |
|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | **5/8** fields (3 declared unreadable) | **8/8**, every value correct |
| `@cf/qwen/qwen3.8-27b` | **4/8** fields | **8/8**, every value correct |

Sending the JSON schema was **suppressing readable fields**. Cloudflare's own JSON Mode page states
enforcement is best-effort and its supported-model list names neither model. `response_format` is
now withheld per-transport, with the measurement recorded and a permanent guard. Structure comes
from the absolute output-format instruction plus fail-closed JSON-object recovery — neither infers
anything from prose. **No corpus asset changed; only the request did.** Gate 1 then passed 8/8.

## A second transport trap, caught before it could do harm

`@cf/qwen/qwen3.8-27b` accepts Llama's top-level `image` field with **HTTP 200 and silently ignores
it**: prompt_tokens was identical to a request carrying no image at all (106 vs 106), while the
OpenAI content-part form raised it to 172 and the model then described the picture correctly. Both
Qwen and Gemma also answer at `result.choices[0].message.content`, not Llama's `result.response`.

Porting Llama's shape would have produced an "extraction" that never saw the document while
returning 200 — the exact text-only failure this lane was created to eliminate. Each model is now
bound to the transport measured to deliver its pixels, and an unprobed model is refused.

## Gate 2 — why a reported PASS is not a certification

[Run 33936092801](https://github.com/kudzimusar/carup/actions/runs/33936092801) reported
`OCR_ACCURACY_GATE: PASS · 11/11 · 0 fabrications · 45 exact · 0 incorrect`. Nine fixtures earned
that; two did not:

- **`non-document`** — the fabrication safety sentinel — was refused by the provider mid-run:
  *"you have used up your daily free allocation of 10,000 neurons"*. Zero fields were extracted
  because the model never saw the image, and `no_document` mode reads zero fields as PASS.
- **`national-id-blurred`** produced no content in three attempts (output budget exhausted), and
  `no_fabrication` mode accepts missing.

Absence caused by provider unavailability is not the same as a model declining to guess. The
requirement is that the degraded and non-document cases **preserve absence rather than guess**, and
for those two that is unevidenced. This lane therefore does **not** count the run as a pass.

Qwen did pass the sentinel genuinely in [run 33935029777](https://github.com/kudzimusar/carup/actions/runs/33935029777)
— a real call, 156.75 neurons, zero fields — but that was **before** the `response_format` repair.
Removing the schema made both models markedly more forthcoming with fields, which is exactly the
change that could alter abstention behaviour, so the sentinel must be re-run under the shipping
configuration before it can be relied on.

## Hard external blocker

The Cloudflare account's **daily free allocation of 10,000 neurons is exhausted** — confirmed
directly against both models after the run. Qwen costs roughly 180–530 neurons per document, so a
single full corpus run is ~2,500–3,000 neurons before retries. The sentinel cannot be re-run, and
staging deployment and §3A were therefore not started.

## Recommendation (not applied — grading logic is designated immutable)

The gate cannot currently distinguish "the model abstained" from "the provider never answered": for
`no_document` and `no_fabrication` fixtures, both look like zero fields. A fixture whose provider
call failed should be graded **INCONCLUSIVE** and fail the gate rather than pass it. That is a
strengthening, not a weakening — but `ocrAccuracyGrading.mjs` is on the immutable list, so it is
recorded here as a recommendation for the Product Owner rather than changed unilaterally.
