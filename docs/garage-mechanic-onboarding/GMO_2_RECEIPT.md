# GMO-2 — Business Evidence + OCR Assistance · RECEIPT

**Status: PASS.** Evidence exists, and extraction assists without ever deciding.

## What now works

An applicant adds proof their garage is real — a photo of the workshop, the sign over the door, a
council licence, a lease, a bill — and can view, replace or withdraw it. PO-2 item 9 is now enforced
at submission: at least one credible business-presence source.

Where a document has text worth reading, CarUp offers to read it. What comes back is a **suggestion
next to a "Use this" button**. Nothing is written into the form until the applicant presses it.

## The two rules the whole phase is built on

**1. Extraction never decides anything.** `garageEvidenceService.js` cannot write
`garage_applications`, and a test asserts that structurally. A hostile provider returning
`{approved: true, verified: true, tenant_id: 'evil', confidence: 0.99}` produces exactly three
candidate fields and no authority — proven in
`GMO-2: OCR output can never approve, reject or advance an application`.

**2. A failure to read is never a failure of the application.** Six extraction states stay apart:

| state | what the person is told |
|---|---|
| `not_attempted` | "Received." |
| `unavailable` | "Reading this automatically is not available. Type the details in yourself." |
| `failed` | "We could not read this automatically. **Your upload is safe** — type the details in yourself." |
| `low_confidence` | "We are not confident we read this correctly. Check each value." |
| `awaiting_confirmation` | "Check these against your document before you use them." |
| `confirmed` | "You have been through these values." |

A test asserts all six produce **distinct** wording, and that `unavailable` contains no
fail/error/problem language. Nothing went wrong; nothing is owed.

## PO-2, honoured concretely

Incorporation is not required and is not implied. The evidence menu **leads with a photo of the
workshop**; company registration sits seventh, labelled *"If you have one — it is not required"*.
The page says so in words: *"you do not need a registered company to work with CarUp."*
A garage trading fifteen years from a yard in Mbare can satisfy this gate with a photograph.

Whether that evidence is good *enough* is the reviewer's judgment in GMO-3 — deliberately not a
schema decision. That split is what keeps **activated ≠ verified** true.

## No provider was activated

Extraction is **off unless `GARAGE_OCR_ENABLED=true`**. A configured provider key alone does not
switch it on — asserted directly. With extraction off the honest state is `unavailable` and the
manual path is the live path, which is the state this lane ships in.

## Decisions worth recording

- **Withdrawal is soft.** A reviewer who saw a document yesterday must not find a gap where their
  reasoning used to be. The row survives with `removed_at` + `removed_by_user_id`; only the live
  count changes.
- **Evidence follows the application's editability.** While CarUp holds a submitted application the
  documents underneath a reviewer's decision cannot be swapped.
- **A broken evidence count raises.** It never returns 0 — the same class of lie as a failed
  membership lookup presenting as "no membership".
- **`submissionBlockers(app, count)` treats `null` as "not measured"** and cannot manufacture a
  blocker from a caller that forgot to count.
- **Evidence refresh does not re-adopt the form.** A person who typed their garage name and then
  uploaded a photo before the 900ms autosave landed would otherwise watch their typing vanish.

## Evidence

| gate | result |
|---|---|
| `gmo-2-garage-evidence.test.js` | **25 / 25** |
| `garageEvidence.test.tsx` | **24 / 24** |
| `gmo-1-garage-application.test.js` (regression) | **19 / 19** |
| `garageSetup.test.tsx` (regression) | **14 / 14** |
| web `src/__tests__` + garage + lib | **431 / 431** |
| migration integrity · route mounting · authority boundaries | **34 / 34** |
| typecheck (`web/tsconfig.app.json`) | clean |

**Real PostgreSQL (approved staging, never production) — 11 / 11.** Each constraint proven by
attempting the refusal: a state naming a provider result must carry one; `not_attempted` cannot
carry an extraction time; **candidates cannot exist without the extraction that produced them**;
confidence outside 0..1 refused; a withdrawal must record who did it; unknown `evidence_type`
refused; an empty file is not evidence; **a signage photo IS acceptable evidence**; the live count
behaves; a withdrawn document survives as a record; deleting an application cascades its evidence.
Readback: 0 rows left, 3 indexes, 7 check constraints.

## Two errors found and fixed in this phase

- **`isExtractionEnabled` ignored its own `env` argument** on the mock branch, consulting ambient
  `process.env` instead. Every caller passing `{}` to mean "off" would have got a live-ish path.
  Fixed, with a drift test pinning it to the canonical OCR predicate.
- **The migration declared `UUID` for user FKs** where `public.users.id` is `TEXT`. Real PostgreSQL
  refused it; grep would not have. Corrected to `TEXT REFERENCES public.users(id)`, matching the 26
  other migrations that do the same, and the corrected file was then applied verbatim so what was
  proven is what ships.

## Also corrected

The lane reconciliation receipt's route-mounting figures (754 / 37 / 57) did not reproduce.
Re-measured with a stated, reproducible method: **760 before GMO, 770 after, GMO delta 10 proven by
ablation**. The conclusion is unchanged and better supported; the correction is recorded in place
rather than swapped, because a committed figure that cannot be re-derived is how a measurement
artifact becomes an architectural claim.
