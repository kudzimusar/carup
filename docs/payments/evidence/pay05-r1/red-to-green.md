# CARUP-PAY-05-R1 — red to green

Final runtime commit `fae7841611b49d3569ec2f1d9cb0c3702a0ef46a`. Names and outcomes only; sequences and working reproductions stay in restricted custody.

## Real PostgreSQL blocks (`backend/tests/sql/pay05-r1-financial-integrity-postgres-smoke.sql`)

| Block | Red run | Outcome there | Payments-first | Garage-first |
|---|---|---|---|---|
| A1 | frozen `1d3b6901` | failed | pass | pass |
| A2 | frozen `1d3b6901` | failed | pass | pass |
| A3 | frozen `1d3b6901` | failed | pass | pass |
| A4 | frozen `1d3b6901` | failed | pass | pass |
| A5 | frozen `1d3b6901` | failed | pass | pass |
| A7 | frozen `1d3b6901` | failed | pass | pass |
| A8 | frozen `1d3b6901` | passed (control) | pass | pass |
| A9 | none: added against a surviving rehearsal mutant | killed that mutant | pass | pass |
| B1 | frozen `1d3b6901` | failed | pass | pass |
| B2 | frozen `1d3b6901` | failed | pass | pass |
| B3 | frozen `1d3b6901` | failed | pass | pass |
| B4 | frozen `1d3b6901` | failed | pass | pass |
| B3b | frozen `1d3b6901` | failed | pass | pass |
| B5 | frozen `1d3b6901` | failed | pass | pass |
| D1 | frozen `1d3b6901` | failed | pass | pass |
| D2 | frozen `1d3b6901` | failed | pass | pass |
| D3 | frozen `1d3b6901` | failed | pass | pass |
| D4 | frozen `1d3b6901` | failed | pass | pass |
| D5 | frozen `1d3b6901` | failed | pass | pass |
| F1 | frozen `1d3b6901` | failed | pass | pass |
| F2 | frozen `1d3b6901` | failed | pass | pass |
| F2b | frozen `1d3b6901` | failed | pass | pass |
| F3 | frozen `1d3b6901` | failed | pass | pass |
| G1 | frozen `1d3b6901` | failed | pass | pass |
| G2 | frozen `1d3b6901` | failed | pass | pass |
| I1 | frozen `1d3b6901` | failed | pass | pass |
| I2 | frozen `1d3b6901` | failed | pass | pass |
| K1 | frozen `1d3b6901` | failed | pass | pass |
| K2 | frozen `1d3b6901` | failed | pass | pass |
| K3 | frozen `1d3b6901` | failed | pass | pass |
| L1 | frozen `1d3b6901` | failed | pass | pass |
| L2 | frozen `1d3b6901` | failed | pass | pass |
| L3 | frozen `1d3b6901` | passed (control) | pass | pass |
| L4 | frozen `1d3b6901` | failed | pass | pass |
| L5 | frozen `1d3b6901` | failed | pass | pass |
| N1 | frozen `1d3b6901` | failed | pass | pass |
| N2 | frozen `1d3b6901` | failed | pass | pass |
| N3 | frozen `1d3b6901` | failed | pass | pass |
| R1 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R1b | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R1c | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R1d | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R1e | `1a902df6`, before the pre-final review's fixes | passed (control) | pass | pass |
| R1f | `7d82cc0d`, before its fix | failed | pass | pass |
| R1g | `7d82cc0d`, before its fix | failed | pass | pass |
| R2 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R3 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R4 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R5 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R6 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R6b | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R7 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R7b | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R9 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R10 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R11 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |
| R12 | `1a902df6`, before the pre-final review's fixes | failed | pass | pass |

## Real-PostgreSQL service tests (`backend/tests/pay05-r1-services.test.js`)

| Test | Red at frozen | Red at `1a902df6` | Now |
|---|---|---|---|
| ICR-M2: Paid, Disputed, Paid, Disputed through signed updates: the second dispute de-counts; none is a resend | failed | - | pass |
| ICR-M2 02b: a dispute learned by poll, then Paid, twice: the second Paid still counts | failed | - | pass |
| ICR-S1: trivially different variants of one signed update are one event: no read, no row, no money | failed | - | pass |
| non-2xx when the confirming poll did not confirm: Paynow resends and the money then applies | failed | - | pass |
| non-2xx when the confirming poll was superseded by a newer read | failed | - | pass |
| ICR-S1: a budget per message bounds the reads status updates can trigger; other messages and polls are unaffected | - | - | pass |
| concurrency: the same signed update delivered five times at once applies once: one allocation, one receipt | - | - | pass |
| concurrency: a settlement racing a Paynow Paid never leaves money counted or a live receipt | - | - | pass |
| concurrency, reordered reads: Paid and Disputed racing on tickets leave the count and the latest word in agreement | - | - | pass |
| concurrency, transaction replay: the same closure sent five times at once closes once and counts nothing | - | - | pass |
| ICR-M3: settled and released requests stay on the operator list and are re-read, at a slow pace | failed | - | pass |
| ICR-M3: looking at an invoice re-reads a request settled outside CarUp, whatever its canonical status | - | - | pass |
| ICR Info: a garage does not read CarUp operators' identities or notes about its own merchant | - | - | pass |
| pay again: an earlier released request is re-read first; money at Paynow on it refuses a new request | failed | - | pass |
| ICR-S2: an integration ID is reserved only with its key proved at connect; the refusal is generic; failures cool down | - | - | pass |
| ICR-S2: Paynow unreachable at connect is not a refusal of the merchant, and reserves nothing | - | - | pass |
| ICR-S6: a key that cannot be opened answers exactly as a missing collection does | failed | - | pass |
| ICR-P5: a poll URL differing only in case or encoding still binds; another poll URL does not | failed | - | pass |
| ICR-P1: without its reviewed settlement currency an integration is not offered and collects nothing | failed | - | pass |
| ICR-P3: if Paynow reports an amount including customer fees, it stays an amount review and counts nothing | - | - | pass |
| ICR-P4: an O'mari request recovered by trace has no address for the code: no form, words instead, and the code is refused if sent | - | - | pass |
| PFR-H2: a reviewed Cancelled after money says what is true, offers no way to complete it, and an operator can release it | - | failed | pass |
| PFR-H2: a reviewed word CarUp does not know can be released; the list and the database agree | - | failed | pass |
| PFR-H3: late money under review on a closed request: no new request is offered or accepted until the review ends | - | failed | pass |
| PFR-H4: late money takes the room; the request still holding it is told not to complete it, and its own money is reviewed, never counted twice | - | failed | pass |
| PFR-H5: the operator's queue is chosen in the database, and says how many there are | - | failed | pass |
| PFR-M1: a hold Paynow cannot be read for has an exit: an operator opens a review and settles it; the garage can then record cash | - | failed | pass |
| PFR-M1: money held at Paynow past CarUp's time: release stays refused, a review is the exit | - | failed | pass |
| PFR-M2: a second delivery whose read saw Paid is not thrown away because an older read wrote first | - | failed | pass |
| PFR-M3: replaying a stale message costs no rows and cannot use up a genuine message's reads | - | failed | pass |
| PFR-M3: a signed message re-split across a field boundary is the same message: it costs reads, never rows, and changes nothing | - | - | pass |
| PFR-M4: room a refund frees counts the money waiting for it, through the real status update | - | - | pass |
| PFR-M5: a closed request never gets waiting words or a way to pay it, and paying again warns about it | - | failed | pass |
| PFR-M5: a page left open cannot pay a request that can no longer be paid, and a replay of it offers nothing | - | - | pass |
| PFR-H4: a replay of a request the invoice no longer needs offers no way to pay it | - | - | pass |
| PFR-L1: Paid, then a read of another amount, then Paid again: a resend reads again, so the operator can close it on Paynow's word | - | failed | pass |
| PFR-L3: a payment counted in part says so, with the part | - | failed | pass |
| PFR-L5: "last read" moves with a read recorded only because it repeats what CarUp holds | - | failed | pass |
| PFR-L7: the customer's stop answer carries the customer's next step, not the garage's | - | failed | pass |
| PFR-L11: a garage does not read the operator's free-text currency reference | - | failed | pass |
| PFR-L12: an operator's failed verification probes do not refuse the garage's own connection | - | failed | pass |
| PFR-L13: reads that fail keep the slow pace: looking at an invoice again does not read Paynow again | - | failed | pass |
| every Paynow collection this file made: counted money has Paynow's applied Paid as its latest word and exactly one live receipt | - | - | pass |

A dash means the test had not been written yet or was not red in that run. Where a test was written after its fix (the second-line and concurrency tests), it was instead proven by mutation: see the mutation report.

## Physical

| Case | Red run | Outcome there | Now |
|---|---|---|---|
| O'mari code form stays on a 390 px screen | served `502d783a` | failed: below the fold | see the browser log at the final commit |
| InnBucks code stays on a 390 px screen | served `5218f77c` | failed: below the fold | see the browser log at the final commit |
