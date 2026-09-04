# Insurer manual — CarUp Intelligence

For insurers.

## What you can see

| Figure | Basis |
|---|---|
| **Live eligibility requests** | Quote requests routed to your registered provider |
| **Eligible / not eligible** | The recorded outcome of those requests |
| **Sandbox activity** | Simulated requests, in a separate block |
| **Provider state** | Whether any insurer is live under a signed contract |

Commercial demand and the risk domain are kept strictly apart. This view is
**demand only**, and the payload says so, so a demand figure cannot be quietly
reused as an underwriting signal.

## What you cannot see, and why

- **Risk scores and premium calculations.** CarUp operates no underwriting model.
  A calculator that previously produced a "monthly underwritten premium" sent a
  VIN, a mileage and a price to a language model and displayed the reply — it read
  no ledger, no claims history and no Trust position. It has been removed rather
  than relabelled.
- **Insurer decisions.** No insurer is onboarded and no provider decision has ever
  been recorded.
- **Risk by vehicle category.** CarUp holds too few claims to derive it.
- **Trust-based premium discounts.** Converting Trust into a discount is a pricing
  judgement CarUp has neither the data nor the mandate to make.

## What you are most likely to misread

**A sandbox request is not market demand.** Every insurance eligibility request
CarUp has recorded ran against a simulator. Summing those into a demand figure
would describe an empty market as an active one, which is why they are reported
separately.

**No live requests is not no interest.** It reflects that no insurer is connected
to receive them.

**Trust is evidence confidence, not risk.** A well-documented vehicle is one CarUp
knows a lot about — not one that is less likely to be claimed on.

**Claims recorded is a volume, not a verdict.** Fraud and underwriting adjudication
are a separate governed domain, and no risk verdict is issued on any intelligence
surface.
