# One CarUp — Evidence certification policy

**Status:** governing from OC-5 onward.

**Enforced by:** `scripts/ci/evidence-certification-guard.mjs`, over the manifest `docs/one-carup/certification/ONE_CARUP_CERTIFICATION_MANIFEST.json`.

**Schema:** `shared/contracts/evidence-certification.schema.json`.

The programme tests deterministic code behaviour with controlled substitutes for external providers. That is valid only when the evidence is classified for what it is. **No mocked, intercepted or simulated provider response is ever presented as real evidence** of any of these:

- provider behaviour;
- Trust or Identity;
- OCR quality;
- the deployed runtime;
- production.

## The five levels

They are cumulative evidence levels, not interchangeable labels. A receipt certifies **one** level for **one** capability. A capability's ladder cell may read `PASS` only when a valid receipt **of that level** exists. Evidence from another level never fills a cell.

| Level | What it requires | What it proves | What it never proves |
|---|---|---|---|
| **SOURCE-CERTIFIED** | Unit, integration and HTTP harness tests, controlled network substitutes, mocked provider transport, source scans, mutation tests, local browser tests | Our code behaves correctly. Authorization and authority boundaries hold. Failure behaviour is correct. Provider request/response contracts are correct. | Model quality, provider availability, the provider's identity at runtime, OCR accuracy, real Trust or Identity, registry truth, deployed behaviour, production readiness |
| **DATABASE-CERTIFIED** | Real PostgreSQL semantics (PGlite, or another disposable PostgreSQL) running the **repository's own** SQL and migrations | Constraints, triggers, functions, transactions, migration behaviour, RLS | The contents or configuration of the real CarUp Supabase projects |
| **LIVE-PROVIDER-CERTIFIED** | An actual call to the named external provider, outside production | The named provider and model answered that request class, at that SHA, with that result | Deployed wiring, production readiness, the owner's acceptance |
| **DEPLOYED-CERTIFIED** | The exact candidate SHA running in the target environment | Deployed SHA, frontend/backend pairing, real runtime configuration, real database target, real route behaviour | The owner's acceptance |
| **OWNER-UAT-CERTIFIED** | A human owner performing or accepting the defined journey | The owner accepted it | — |

**Receipt requirements by level:**

- **LIVE-PROVIDER-CERTIFIED** receipts carry: provider, model, environment, exact SHA, request class, non-secret execution evidence (for example a request id, usage and latency), result, and timestamp. They never carry credentials or sensitive content.
- **DEPLOYED-CERTIFIED** receipts carry: the deployed SHA (which must equal the receipt SHA), the frontend and backend deployments, runtime-configuration evidence, the database target, and route behaviour.
- **OWNER-UAT-CERTIFIED** receipts carry a human attestation: name, role, time, and a record reference. Automation cannot manufacture one.

## Mock and simulation prohibition

Mocks are permitted for SOURCE-CERTIFIED contract proof **only**. They can never establish:
- LIVE-PROVIDER, DEPLOYED or OWNER-UAT certification;
- or any of these authority facts:
  - Trust verified, Identity verified;
  - document genuine, registry genuine, vehicle genuine;
  - fraud cleared;
  - insurance approved, finance approved;
  - payment released, listing approved;
  - biometric match.

A simulated or model response is never persisted or presented as a real authority fact merely because its test passed. "Gemma certified", "Qwen certified" and "OCR accuracy certified" may be written only when a real LIVE-PROVIDER receipt for that model exists.

## Every phase receipt declares

| Field | Meaning |
|---|---|
| `capability` | What is being certified, for example `partsentry.service_authority` |
| `sha` | The exact commit the evidence was produced on. It must be an ancestor of the manifest's HEAD. Because a commit cannot name itself, receipts are recorded in a later commit. |
| `level` | One of the five levels |
| `environment` | `localhost` / `local` / `ci` / `test` / `sandbox` / `staging` / `preview` / `production` |
| `proof_mechanism` | How the evidence was produced |
| `provider` | `{ name, model, mocked }`, or `null` when no external provider is involved |
| `database` | `{ engine: pglite \| postgres-disposable, migrations[] }`, or `null` |
| `mocked_provider` and `mocked_components` | Every intercepted or substituted component, named |
| `claims` | What the receipt asserts. Authority facts are refused for mocked or below-live evidence. |
| `remaining` | The higher levels still required |
| `recorded_at` | When the receipt was recorded |

## What the guard rejects

Each rule has a negative test in `backend/tests/oc5-evidence-certification-guard.test.js`.

1. `mocked_provider = true`, or a mocked provider/model/transport component, at LIVE-PROVIDER level or higher.
2. A `localhost` / `local` / `ci` / `test` / `sandbox` environment at DEPLOYED level or higher.
3. A LIVE-PROVIDER receipt that is missing its provider, model, request class, execution evidence, result or timestamp; that has `provider.mocked`; or that ran against production.
4. A DEPLOYED receipt that is missing its deployment, pairing, configuration, database or route evidence, or whose deployed SHA is not the receipt SHA.
5. An OWNER-UAT receipt without a human attestation.
6. A DATABASE receipt not on PGlite or disposable PostgreSQL, without repository migrations, or naming a real CarUp Supabase project.
7. An authority-fact claim from mocked or below-live evidence. A provider-quality claim without a real run of that model.
8. A ladder `PASS` with no valid receipt of that exact level.
9. A receipt whose SHA is not a commit, or not an ancestor of HEAD.
10. A programme document (`docs/one-carup/OC5*.md`, `*RC2*.md`) that states provider quality with no live receipt behind it. A line that negates the claim, such as the prohibitions above, is not a claim.
