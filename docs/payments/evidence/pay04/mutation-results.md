# PAY-04 remediation — mutation results at the runtime candidate

Each mutant re-introduces ONE defect found by the independent review or by the physical UAT, by an exact source replacement asserted to apply exactly once, in a detached worktree at `d421965e` (the runtime candidate). The killer is the suite that is supposed to catch it. Baselines were green before the pass; every file was restored, and the worktree was clean afterwards (true).

**Result: 37/37 killed** — database 12/12, services 15/15, web 10/10.

| Mutant | Killer | Result | First failing assertion |
|---|---|---|---|
| D01 later provider refund ignored after a final resolution | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:376: ERROR:  PAY04_SMOKE_CHECK_FAILED: the remainder follows the provider: 80 counts |
| D02 pending refunds of a final partial refund not held | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:376: ERROR:  PAY04_SMOKE_CHECK_FAILED: pending refund: not counted, held |
| D03 a stop / CarUp expiry releases the room before the provider confirms | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:293: ERROR:  PAY04_SMOKE_CHECK_FAILED: a stop alone does not release the reservation |
| D04 a live checkout binds to a closed collection | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:240: ERROR:  PAY04_SMOKE_WRONG_ERROR: expected PAY04_COLLECTION_CLOSED got PAY04_CANONICAL_PAYMENT_B |
| D05 an unattached stop leaves the canonical payment pending | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:240: ERROR:  PAY04_SMOKE_CHECK_FAILED: an unattached stop closes the canonical payment |
| D06 a mismatch on counted money is recorded but not re-projected | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:481: ERROR:  PAY04_SMOKE_CHECK_FAILED: a later mismatch un-counts counted money |
| D07 money counts while a mismatch is open | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:481: ERROR:  PAY04_SMOKE_CHECK_FAILED: paid while two mismatches are open: recorded, not counted, he |
| D08 off-platform-settled money starts counting when room appears | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:481: ERROR:  PAY04_SMOKE_CHECK_FAILED: the operator closure sticks |
| D09 a stale "uncounted" flag never closes itself | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:481: ERROR:  PAY04_SMOKE_CHECK_FAILED: room re-projects it and the flag closes itself |
| D10 an operator closure does not re-project | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:481: ERROR:  PAY04_SMOKE_CHECK_FAILED: once every mismatch is closed the money counts |
| D11 a billed part can be reversed | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-invoice-integrity-postgres-smoke.sql:188: ERROR:  PAY04_SMOKE_EXPECTED_FAILURE: PAY04_PART_USAGE_INVOICED (sql: SELECT garage_ops06_rever |
| D12 CarUp closes an ATTACHED expired collection without the provider | integrated PostgreSQL certification (payments-first) | **KILLED** | pay04-garage-provider-payments-postgres-smoke.sql:293: ERROR:  PAY04_SMOKE_EXPECTED_FAILURE: PAY04_COLLECTION_ATTACHED (sql: SELECT pay04_close_expire |
| J01 a stopped-but-unconfirmed checkout reads as "stopped" | real-PostgreSQL service suite | **KILLED** | not ok 11 - collection states never call money paid, or a checkout closed, before the provider says so |
| J02 every provider row says "confirmed" | real-PostgreSQL service suite | **KILLED** | not ok 12 - a provider row never says "confirmed" unless the provider confirmed it; the invoice names the source that counts |
| J03 the customer card shows other payers' provider payments | real-PostgreSQL service suite | **KILLED** | not ok 13 - the customer card shows only the customer's own provider payments and receipts; the totals stay the invoice's |
| J04 a refused refund is reported as sent | real-PostgreSQL service suite | **KILLED** | not ok 14 - a refund the provider refuses is reported as refused, the payment still counts, and asking again is a new request |
| J05 one provider refund key per collection | real-PostgreSQL service suite | **KILLED** | not ok 14 - a refund the provider refuses is reported as refused, the payment still counts, and asking again is a new request |
| J06 a stop is recorded although the provider could not be reached | real-PostgreSQL service suite | **KILLED** | not ok 15 - stopping a checkout asks the provider first; the room is released only when the provider confirms it closed |
| J07 a new payment does not read expired checkouts first | real-PostgreSQL service suite | **KILLED** | not ok 16 - an expired checkout is closed with the provider before its room is reused (new payment, void); the provider refuses it after expiry |
| J08 an amount-less retry uses the current balance | real-PostgreSQL service suite | **KILLED** | not ok 17 - retrying a start without an amount replays the original checkout |
| J09 the F5 operator path accepts another merchant's evidence | real-PostgreSQL service suite | **KILLED** | not ok 18 - the F5 operator path refuses provider evidence that names another merchant |
| J10 a reversal does not re-project provider money | real-PostgreSQL service suite | **KILLED** | not ok 19 - room that reappears (a declared payment is reversed) re-projects provider money the invoice could not absorb |
| J11 the customer's stop response carries internal references | real-PostgreSQL service suite | **KILLED** | not ok 15 - stopping a checkout asks the provider first; the room is released only when the provider confirms it closed |
| J12 a void does not read expired checkouts first | real-PostgreSQL service suite | **KILLED** | not ok 16 - an expired checkout is closed with the provider before its room is reused (new payment, void); the provider refuses it after expiry |
| J13 the invoice label ignores provider money | real-PostgreSQL service suite | **KILLED** | not ok 12 - a provider row never says "confirmed" unless the provider confirmed it; the invoice names the source that counts |
| J14 the provider takes money after the expiry it was given | real-PostgreSQL service suite | **KILLED** | not ok 16 - an expired checkout is closed with the provider before its room is reused (new payment, void); the provider refuses it after expiry |
| J15 the Garage Hub (closeout) invoice carries no provider activity | real-PostgreSQL service suite | **KILLED** | not ok 20 - the Garage Hub (closeout) carries the provider payment activity of its live invoice |
| W01 raw PAY04_ codes reach people | PAY-04 vitest files | **KILLED** | × PAY-04 refusals reach people as sentences, never raw codes 3ms; × closing an exception needs a written note and reports the server’s refusal in word |
| W02 any amount is sent unchecked | PAY-04 vitest files | **KILLED** | × an online amount is checked, in the currency’s own precision, before anything is sent 2ms; × an amount is checked before it is sent: a bad one disab |
| W03 "nothing was charged" before the provider confirms | PAY-04 vitest files | **KILLED** | × a checkout the provider has not yet confirmed closed is never "nothing was charged" 3ms |
| W04 a changed amount reuses the request key | PAY-04 vitest files | **KILLED** | × a changed amount is a new request (new key); a refusal is shown as a sentence 14ms |
| W05 stop acts on one tap | PAY-04 vitest files | **KILLED** | × stopping asks first; a refusal shows even when online payment is not on offer; success refreshes the invoice 19ms |
| W06 a check does not refresh the invoice card | PAY-04 vitest files | **KILLED** | × a check that changes the payment refreshes the invoice above it 5008ms |
| W07 the hub shows a provider refusal as a raw code | PAY-04 vitest files | **KILLED** | × a provider refusal reaches the hub as a sentence, never a raw code or a success 5011ms |
| W09 the Garage Hub payment step says "recorded by the garage" while provider money counts | PAY-04 vitest files | **KILLED** | × the Garage Hub payment step 5ms |
| W10 the garage invoices list calls provider money "Recorded payments" | PAY-04 vitest files | **KILLED** | × the garage’s invoices list: status, amounts by source and the section note 10ms |
| W08 the later-refund flag offers the wrong closure | PAY-04 vitest files | **KILLED** | × a refund the provider reported after a final resolution is reviewed with its own closures 9ms |

An earlier pass of the first 34 mutants (at `c8e45625` and `da6037df`) also killed all 34; this run repeats them at the candidate and adds J15, W09 and W10 for the physical-UAT findings P1–P2.

Harness: [`pay04_mutation_r1.py`](pay04_mutation_r1.py) (the disposable PostgreSQL on 127.0.0.1:55432 and a detached worktree only).
