# Lender manual — CarUp Intelligence

For banks and finance providers.

## What you can see

| Figure | Basis |
|---|---|
| **Applications received** | Applications routed to you, on the same key the application queue uses |
| **Decisions recorded** | Only where a decision timestamp or decision source exists |
| **Awaiting decision** | The remainder |
| **Live prequalification** | Eligibility requests routed to your registered provider |
| **Sandbox activity** | Simulated prequalification, in its own block |

## What you cannot see, and why

CarUp holds **no disbursement state anywhere in its schema**. There is no record of
money lent, repaid, in arrears or in default. Consequently:

- **Approvals and offers** — no lender decision has ever been recorded on CarUp,
  and no lender is onboarded to make one.
- **Disbursements and portfolio value** — nothing to derive them from.
- **Average portfolio APR** — an APR on a pending application is a quoted rate, not
  a rate anybody is paying.
- **Default and delinquency** — no repayment state exists.
- **Collateral tracking** — vehicle telemetry carries no loan, application or
  collateral reference, so no telemetry record can be attributed to a financed
  asset.

## What you are most likely to misread

**A requested amount is not money lent.** It is what a borrower asked for on a
pending application. Summing requested amounts would manufacture a loan book, and
CarUp deliberately publishes no such total.

**A status string is not a decision.** Nothing in CarUp sets an application status
on a lender's behalf, so a status of "approved" without a recorded decision is not
an approval.

**Your application count is not total market demand.** CarUp also holds
applications attached to no lender, which appear in no lender's view. That gap is
disclosed to you, though its size is a platform figure.

**CarUp Trust is not a credit signal.** Trust states confidence in evidence about a
*vehicle*. It says nothing about a borrower's ability or willingness to repay, and
converting it into a credit grade — as an earlier surface did — is not something
CarUp has either the data or the mandate to do.
