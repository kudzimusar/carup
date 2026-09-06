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

## It has now happened, for real, on staging

This stopped being hypothetical. With a **real, valid, correctly-wired** Gemini credential in front
of the deployed staging classifier, a live identity case was refused:

```
verification_sessions.failure_reason
  "Classification provider error: Gemini vision API 429: Your prepayment credits are depleted."
```

A billing lapse — not an outage, not a misconfiguration, not a bad key — produced exactly the total
identity-verification unavailability this document predicts. Every subject, indefinitely, with no
human path back. **A depleted prepay balance is currently indistinguishable, in effect, from
switching identity verification off.**

### And a second finding: the reviewer could not see why

Before the run, the same case recorded only this:

```
"Classification provider error: Malformed Gemini vision API response"
```

`GeminiClient.askGeminiVision` discarded the provider's response before throwing, so a quota
refusal, a safety block and a bug in CarUp's own parser all reached the compliance reviewer's row as
the same eight words. The reviewer is asked to act on that row. It told them nothing, and it pointed
at the wrong party. (It also read `parts[0].text`, which is not where a multi-part 2.5-series
candidate necessarily puts its text — so a perfectly good answer read as malformed.)

Fixed in `backend/services/ai/GeminiClient.js`, both the vision and text paths. But the lesson
belongs to this document, because it changes the shape of the requirement:

> **Provider-failure observability is part of the resilience gap, not separate from it.** A
> degraded-mode policy that cannot distinguish "we are out of credit", "the provider is down",
> "the image was refused on safety grounds" and "our client is broken" cannot choose the right
> behaviour for any of them, and cannot tell the subject or the reviewer the truth.

Add to the decisions below: **what a reviewer and a subject are each told when the provider fails,
per failure class** — and which of those classes is an operational alert rather than a case note. A
depleted balance is an ops page, not a finding against the applicant.

## What a design must decide (not decided here)

1. **What evidence constitutes a valid human manual-review path** — and how a reviewer proves they
   examined the document, rather than merely asserting an outcome.
2. **Distinct provenance.** Automated provider evidence and human evidence must never be recorded as
   the same kind of fact. A `verified` minted from a human review must be distinguishable, forever,
   from one minted from provider classification — in the ledger, in the assurance projection, and in
   anything a downstream consumer reads.
3. **How a reviewer is prevented from fabricating `verified`.** The current impossibility is a
   feature; any manual path must replace it with an equally hard constraint, not remove it.
4. **Degraded-mode policy.** What the product tells subjects and reviewers during an outage, per
   failure class (credit exhausted / provider down / evidence refused / client defect), whether
   pending cases queue or fail, and which classes page operations instead of sitting on a case.
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
