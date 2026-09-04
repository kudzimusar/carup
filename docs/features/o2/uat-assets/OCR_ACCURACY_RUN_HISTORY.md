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
