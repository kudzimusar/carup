# CARUP-PAY-05-R1 — Agent register, acceptance ledger and continuity handoff

Remediation issue #256, certification issue #255, affected PR #254 (Draft, unmerged). Evidence: [CARUP_PAY_05_R1_CERTIFICATION.md](CARUP_PAY_05_R1_CERTIFICATION.md).

## Agent register

The directive asks for one remediator, one different independent certifier, and a separate reviewer for the cross-program test policy.

| Role | Who | Access | Output | Disposition |
|---|---|---|---|---|
| Remediator (single source writer) | The PAY-05 implementation specialist, Claude Opus 5.5, session of this assignment | The R1 worktree; disposable local stacks | Every commit on `fix/carup-pay-05-r1-financial-integrity` | May not certify its own work |
| Pre-final adversarial reviewer | A fresh agent started by the remediator, given the code and a private sandbox and no conclusions | Read-only worktree; disposable PostgreSQL | 5 High, 5 Medium, 13 Low (PFR ids) | All dispositioned in the closure matrix. Not the certifier |
| Independent final certifier | Pending: a fresh agent started by the remediator, given the code, the original report and a private sandbox, and no conclusions | Read-only worktree at the evidence head; disposable PostgreSQL; the running local runtime | Pending | Pending |
| Reviewer for the cross-program test guard (O2-X4) | Fresh agents started by the remediator, three in all. **Not the O2 programme's owner** | Read-only worktree; private fixture folders; no database | REQUEST CHANGES twice on the design, twice on the wording, then APPROVE at `f3b1cf53` | Every blocking finding corrected; the Moderator decides whether this is enough |

**Limit on independence, stated plainly.** The certifier and the O2 reviewer are fresh agents started from the remediator's session, on the same account and the same model family, with no access to its working notes or conclusions until the step that checks them. They are not people, and the remediator wrote their briefs, which are kept in private custody with hashes. Whether that meets "a truly separate certifier" and "the O2 owner's independent signoff" is the Moderator's decision. If it does not, the private handoff lets a separate session or person repeat the certification from the same reproductions.

## Acceptance ledger

| Item | State | Authority |
|---|---|---|
| PAY-05 at frozen head `1d3b6901` | Not accepted: ICR-01 returned REMEDIATE | Moderator, #255 |
| R1 Level 1 remediation at runtime `fae78416` | Pending the independent certification | Moderator |
| Cross-program test guard O2-X4 | Independently reviewed, not owner-signed. Three questions are open for the Moderator (certification §4 and the closure matrix) | Moderator, O2 owner |
| Real Paynow, Level 2 | Blocked: needs the Owner's and Paynow's merchant and financial authority | Owner, Moderator |
| PAY-06 | Implementation blocked until R1 is accepted; read-only preparation allowed | Moderator |
| PR #254 | Draft, unmerged. Not changed by R1 | Moderator, Owner |
| A pull request for this branch | Not opened: see the certification, §4 | Owner |

## Continuity handoff

| Field | Value |
|---|---|
| Task | CARUP-PAY-05-R1 |
| Branch | `fix/carup-pay-05-r1-financial-integrity` |
| Frozen defective head | `1d3b690198c5f0842fc580f36280714fedaba32a` |
| Accepted parent | `b3ca4d211f316a40728d56612f4d975c745c4061` |
| Final runtime commit | `fae7841611b49d3569ec2f1d9cb0c3702a0ef46a` |
| Evidence head | the commit that adds this file, or a later documents-only commit |
| Exact-head CI | Recorded in the certification after the push |
| Private handoff | `~/carup-launch-evidence/pay05-r1/HANDOFF.md`, with the ICR's report, its 184 evidence files, every reproduction, the review's scripts and their outputs. Not in this repository |
| Open | The items in the certification's limits and Level 2 gates |
| Next action | The Moderator decides on R1. On acceptance: PAY-06, without repeating accepted PAY-05 architecture. Real Paynow stays blocked until the Owner and Paynow supply the merchant and financial authority |
