# CarUp Intelligence — stakeholder manuals

One manual per stakeholder, derived from the canonical plan and the phase receipts.

Each answers the same three questions, in the order a stakeholder actually asks
them:

1. **What can I see?** — the figures CarUp publishes to you, and where each comes
   from.
2. **What can I *not* see, and why?** — the questions CarUp cannot answer for you.
3. **What am I most likely to misread?** — the adjacent figure each number is
   commonly mistaken for.

The third question is why these manuals exist. Nearly every fabrication the
programme removed was a figure standing in for a neighbour it resembled: a
requested loan amount read as money lent, a sandbox settlement read as a
settlement, a scheduled milestone read as money received, CarUp's own document
review read as a government verification. Fixing the code stops the surface
asserting it. Only the manual stops the reader assuming it.

| Manual | Stakeholder |
|---|---|
| [`seller.md`](seller.md) | Private sellers and vehicle owners |
| [`dealer.md`](dealer.md) | Dealerships and their staff |
| [`lender.md`](lender.md) | Banks and finance providers |
| [`insurer.md`](insurer.md) | Insurers |
| [`institutional.md`](institutional.md) | Government and regulatory readers |

## The rules every manual shares

**A figure CarUp has not measured is never shown as zero.** Wherever a number
cannot be produced, the surface says so and gives the reason. "Not measured" and
"none" are different statements and are always rendered differently — including in
exported files, where an unmeasured figure is written as the words `NOT MEASURED`
rather than left blank, because a blank cell becomes a zero the moment a
spreadsheet column is summed.

**Trust means confidence in evidence about a vehicle.** It is not a credit score,
not an insurance risk rating, and not a verdict on a seller. `not_evaluated` means
CarUp has not evaluated that vehicle; it never becomes 0, "failed" or "poor".

**Sandbox activity is never counted as live.** CarUp has no live payment provider.
Escrow sessions, SafeTrade transactions and finance prequalifications that ran
against a simulator are reported in their own blocks and never combined with live
figures — of which there are currently none.

**Nothing is confirmed by a registry.** No government or revenue-authority
integration is connected. CarUp reviews documents supplied to it; that review is
its own, and is never described as an official verification.

**Amounts are never summed across currencies.** CarUp applies no exchange rate, so
each currency is reported separately.
