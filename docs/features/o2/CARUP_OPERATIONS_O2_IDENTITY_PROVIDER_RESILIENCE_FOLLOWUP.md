# O2 follow-up — Identity Verification Provider Resilience / Manual Review

**Status:** OPEN. **Owner decision required.**
**Owner:** O2 People & Compliance.
**Provenance:** raised by Garage & Mechanic Onboarding 1.0 (GMO-8) on PR #209 (record at `ce45e16f`,
`docs/features/o2/CARUP_OPERATIONS_O2_IDENTITY_PROVIDER_RESILIENCE_FOLLOWUP.md`). Carried onto the One CarUp lineage by
OC-5R-PC01 (PC01-F item F7) and re-keyed to this lineage's code. #209 described a Gemini classifier; this lineage
classifies through the governed Cloudflare Workers AI vision provider. The failure has the same shape.

**Nothing in this document is implemented.** It records a gap, and the decisions needed to close it.

---

## The fact

> If the vision classifier is missing, misconfigured or failing, governed identity approval is **unavailable**.
> It is not degraded. No reviewer can approve any case until the provider answers again.

### Layer 1 — the classifier cannot pass anything without a provider

`backend/services/identity/documentClassifier.js`:

| Provider state | Result |
|---|---|
| `resolveVisionProvider()` throws (misconfiguration) | `UNCERTAIN`, reason `Classification provider misconfigured: …` |
| `provider.isConfigured()` is false (missing `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`) | `UNCERTAIN`, reason `Classification provider "cloudflare" is not configured (requires …)` |
| The provider call fails (HTTP error, timeout, quota) | `UNCERTAIN`, reason `Classification provider error: …` |
| The answer cannot be parsed | `UNCERTAIN` |

The deterministic Layer-1 checks (size, blur, duplicate sides) can only reject. None of them can produce a passing
classification. Every `UNCERTAIN` is stored as `primary_reason_code = 'DOCUMENT_NOT_VISIBLE'`. Extraction does not run.

### Layer 2 — the decision policy refuses approval

`DOCUMENT_NOT_VISIBLE` is `approveAllowed: false` (`reasonCodes.js`). `DecisionPolicyEngine._checkApprove` therefore
refuses approval, and also refuses any `uncertain` evidence classification.

### Layer 3 — a reviewer cannot clear it, by design

Since PC01-F F1, `VerificationDecisionRecorder.mayChangePrimaryReason` never lets a reviewer action replace a
system-assigned blocking reason with an approvable one. Resubmission and rejection still assign the reason they
carry.

Before F1, this lineage did have a human path: escalate with `OTHER`, then approve. It was a **security defect**, not
a fallback. It approved, without trace, evidence the system had refused, and nothing recorded that approval as human
judgement over a provider outage. Closing it made the gap below true by construction. A real fallback has to be
designed (see below); it must not be reopened by accident.

### Layer 4 — the lifecycle ledger accepts `verified` only from the governed approval

`backend/services/identity/identityLifecycleService.js`, `APPROVAL_ONLY_STATES` (`VERIFIED`, `RECOVERED`). Only the
governed approval hook can enter these states. Its single caller is the decision recorder, after the policy allows
APPROVE.

**Each layer is correct on its own. Together they leave no human path during a provider outage.**

---

## Consequence

- A provider outage stops identity verification for every subject until the provider returns. A credit lapse,
  misconfiguration or quota exhaustion does the same, and so does a production deployment without the provider's
  configuration.
- Every programme that gates on governed identity stops with it: seller authority, dealer onboarding's responsible
  person, and garage activation. GMO-8 was the first documented case.
- **The applicant is told something false.** The guidance for `DOCUMENT_NOT_VISIBLE` is *"No identity document could
  be seen in the submitted images."* During an outage this blames the applicant for an infrastructure fault.
- **The reviewer learns little more.** The provider's reason is recorded on the case, but the case looks like a
  finding against the applicant, not an incident.

### Evidence on record

- **#209, GMO-8, staging, with a valid and correctly wired Gemini credential:** every classification returned
  `429 "Your prepayment credits are depleted"`. That was eleven attempts across three deployments. A billing lapse was
  indistinguishable, in effect, from switching identity verification off.
- **This lineage, staging (OC-5R-REL-02):** the Cloudflare provider is configured and deployed-live (Qwen, proof run
  37728492328). The gap is latent here, not active. It becomes active the moment the provider is unavailable.

---

## Resolved on this lineage (for the record)

- `likely_identity_document` with trusted extraction is reviewable evidence. Classification and extraction trust are
  independent axes; extraction trust needs positive proof that the provider processed the image. This is the Product
  Owner's ruling §12D, ported as PC01-F F2 from #209 `43be0ad2`.
- A reviewer can no longer relax a system blocker (PC01-F F1, above).

---

## What the Owner must decide

1. **Whether there is a human manual-review path** while the provider is unavailable. If there is, decide what
   evidence makes it valid, and how a reviewer proves they examined the document rather than merely asserting an
   outcome.
2. **Distinct provenance.** A `verified` from human review during an outage must be distinguishable forever from one
   backed by provider classification: in the decision row, the lifecycle ledger, the `identity_assurance.v1`
   projection, and everything downstream reads.
3. **How a reviewer is prevented from fabricating `verified`.** Today's impossibility is a feature. Any manual path
   must replace it with an equally hard constraint: for example, step-up plus two-person review plus mandatory evidence
   notes.
4. **Degraded-mode messaging and routing, per failure class:** credit exhausted, provider down, misconfigured, client
   defect, and evidence refused. Decide what the subject is told, what the reviewer is told, whether pending cases
   queue or fail, and which classes page operations instead of sitting on a case.
5. **Production failover:** a second provider, queue-and-retry, or an explicit maintenance state.
6. **Credential provenance.** A provider credential should carry non-secret provenance (account or project label),
   so an account-side outage can be traced without reading the secret.
7. **Production configuration is a promotion precondition.** Without the provider's configuration, every production
   identity case is refused as `DOCUMENT_NOT_VISIBLE`. The promotion gate must show the provider is configured (by
   variable name, never by value) and live before identity verification is offered.

---

## What must not be done

- Do not weaken `APPROVAL_ONLY_STATES`.
- Do not weaken `mayChangePrimaryReason`. Do not let a reviewer's reason code override a stored blocking reason
  without a designed, audited manual-evidence path.
- Do not write a `verified` lifecycle row directly, in SQL or otherwise, in any environment.
- Do not change identity authority as a side effect of unblocking a downstream programme. GMO-8 was held PARTIAL
  rather than do this.
