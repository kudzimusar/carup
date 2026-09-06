# O2 follow-up — Identity Verification Provider Resilience / Manual Review

**Status:** OPEN. Raised by Garage & Mechanic Onboarding 1.0 (GMO-8) during execution.
**Owner:** O2 People & Compliance. **Not** GMO's to resolve.
**Nothing in this document has been implemented.** GMO deliberately did not change identity
authority to make itself pass; see §"What must not be done" below.

---

## The observed fact

> With the current O2 contract, loss or non-configuration of the vision classifier makes governed
> identity approval **unavailable** — not degraded, unavailable.

This is not inferred from reading. It was walked end to end on a deployed staging build with no
provider key, and the refusal was reproduced by name at every layer.

### Layer 1 — the classifier cannot pass anything

```js
documentClassifier.js
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !mockAllowed) return { classification: UNCERTAIN, reason: 'Classification provider unavailable.' }
```

The deterministic Layer-1 checks are **rejection-only** by design: they can fail an image for size,
blur or front/back duplication, but nothing in them can produce a passing classification. With no
provider, `UNCERTAIN` is the only reachable outcome.

### Layer 2 — the decision policy then refuses approval

`UNCERTAIN` persists as `verification_sessions.primary_reason_code = 'DOCUMENT_NOT_VISIBLE'`, and:

```js
decisionPolicy._checkApprove()
  const reasonConfig = getReasonConfig(reasonCode);
  if (!reasonConfig.approveAllowed)
    return { allowed: false, reason: `Approval is not permitted when the primary reason is "${reasonCode}".` }
```

Every document-quality reason code carries `approveAllowed: false`.

### Layer 3 — the reviewer's own judgement never reaches the check

```js
decisionPolicy.buildAssessmentSummary(session, …)
  const primaryReasonCode = session.primary_reason_code || classificationResult?.reasonCode || null;
```

The policy input is the reason code **stored on the session row**. A reviewer's `reason_code` is
recorded on their decision but is never consulted here, so it cannot clear a blocking one.

### Layer 4 — and the lifecycle ledger will not accept a hand-made `verified`

```js
identityLifecycleService.js
  const APPROVAL_ONLY_STATES = new Set([LIFECYCLE_STATES.VERIFIED, LIFECYCLE_STATES.RECOVERED]);
  // "States only the identity domain itself may enter, via the governed approval hook — a human
  //  transition endpoint cannot mint them, and the SUBJECT can never reach them at all."
```

The only writer of a capability-bearing state is `onVerificationApproved`, reached from
`decisionRecorder` **after** the policy has allowed APPROVE.

**Each of these four is correct on its own.** Together they mean there is no human degradation path.

---

## Consequence

- A provider outage is a **total identity-verification outage**, for every subject, indefinitely.
- Every downstream programme that PO-2-style gates on governed identity stops with it. **Garage &
  Mechanic Onboarding is the first documented case**: a legitimate Zimbabwe garage cannot be
  activated while the classifier is unavailable, no matter how good its business evidence is or how
  willing a compliance reviewer is to look at the document themselves.
- The failure is silent from the outside: the reviewer sees a refusal that reads like a finding
  against the applicant, not like an infrastructure outage.

---

## What a design must decide (not decided here)

1. **What evidence constitutes a valid human manual-review path** — and how a reviewer proves they
   examined the document, rather than merely asserting an outcome.
2. **Distinct provenance.** Automated provider evidence and human evidence must never be recorded as
   the same kind of fact. A `verified` minted from a human review must be distinguishable, forever,
   from one minted from provider classification — in the ledger, in the assurance projection, and in
   anything a downstream consumer reads.
3. **How a reviewer is prevented from fabricating `verified`.** The current impossibility is a
   feature; any manual path must replace it with an equally hard constraint, not remove it.
4. **Degraded-mode policy.** What the product tells subjects and reviewers during an outage, and
   whether pending cases queue or fail.
5. **Production failover.** Whether a second provider, a queue-and-retry, or an explicit
   maintenance state is the answer. **Unresolved.**

---

## What must not be done

- Do not weaken `APPROVAL_ONLY_STATES`.
- Do not let a reviewer's own reason code override a blocking stored reason code without a designed,
  audited manual-evidence path.
- Do not write a `verified` lifecycle row directly, in SQL or otherwise, in any environment.
- Do not change identity authority as a side effect of unblocking a downstream programme. GMO-8 was
  held PARTIAL rather than do this, and was only closed once a real provider was configured on
  staging under explicit Product Owner authorization.

---

## Provenance of this finding

Walked on the deployed staging preview during GMO-8; see
`docs/garage-mechanic-onboarding/GMO_8_RECEIPT.md` (§"There is no human fallback", §"the ledger
refuses it a second time") and the Garage & Mechanic Onboarding canonical plan §12B.
