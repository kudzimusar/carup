# CARUP-PAY-05-R1 — Defect closure matrix

Every finding of the independent certification CARUP-PAY-05-ICR-01 (issue #255, remediation issue #256), with its correction, the
regression test that failed before it and passes after it, and what risk remains. Reproductions and working sequences stay in the
restricted handoff; this file names causes and corrections only.

**Reproduced by:** "F" finance, "N" negative-path, "S" security, "P" protocol and "W" web are the ICR's specialist reviewers, who each
found and reproduced their findings independently. The ICR's certifier session re-ran every executable reproduction. R1 replayed the
same scripts against the corrected code, in restricted custody, with only the fixture changes the new onboarding rules require.

**After the ICR's findings were corrected,** a further reviewer, given the corrected code and no conclusions, attacked it in a private
sandbox and found 5 High, 5 Medium and 13 Low defects. They are listed below as "PFR" and were corrected the same way, test first. That
reviewer was a separate fresh agent working before certification. It is neither the implementer nor the independent certifier.

**Where tests live:**
- `smoke`: `backend/tests/sql/pay05-r1-financial-integrity-postgres-smoke.sql` (real PostgreSQL), by block;
- `services`: `backend/tests/pay05-r1-services.test.js` (real PostgreSQL and real HTTP to the protocol simulator);
- `views`: `backend/tests/pay05-paynow-views.test.js`;
- `protocol`: `backend/tests/pay05-paynow-protocol.test.js`;
- `adapter`: `backend/tests/pay05-paynow-adapter.test.js`;
- `truth`: `web/src/lib/pay05PaynowTruth.test.ts`;
- `screens`: `web/src/components/owner/serviceJourney/PaynowTruth.r1.test.tsx`;
- `matrix`: `scripts/uat/pay05-http-matrix.mjs`, by case;
- `browser`: `web/e2e/pay05-r1-state-truth.spec.ts`.

## Critical and High

| ID | Sev. | By | Root cause | Correction | Regression | After | Residual risk |
|---|---|---|---|---|---|---|---|
| ICR-M1 | Critical | F, N | The reprojection counted from the canonical status alone. Closing a review therefore counted money again on a canonical row still reading `paid`, and the settlement cap covered only PAY-04's own review type. | Paynow money counts only while Paynow's own latest evaluated word is a matching applied Paid. A settlement caps a payment at what counted then, for every Paynow review type. `provider_corrected` needs Paynow's own Paid. | smoke A1–A5, A7; services "settlement racing a Paid"; matrix F1 | Never re-counted, no new receipt, the garage records real cash, a later Refunded still acts | None known at Level 1 |
| ICR-M2 | High | N, F | A status update's identity remembered one step, so a repeat of an earlier message was discarded as a resend, with a 200 that ended Paynow's retries. | Identity is the received Paynow hash plus a monotonic per-collection generation. A status differing from the one held is never a duplicate. Non-2xx when the confirming poll was not evaluated or does not agree. | services "ICR-M2", "non-2xx…"; smoke N1; matrix F3, F5 | Each dispute and each Paid applies | Real dispute word sequences are a Level 2 question |
| ICR-M3 | High | N, F | After a settlement every Paynow report was ignored unconditionally, and released or settled requests were no longer read. | Only a repeat of the settled evidence is recorded-only. New money opens `provider_paid_after_close` and is never allocated. Disputed and Refunded still act on what counts. Settled and released requests stay listed and are re-read hourly. | smoke B1–B5; services "ICR-M3"; matrix F2 | New money is reviewed, audited, unallocated | Hourly re-reads depend on someone viewing the invoice; Paynow's own update is the primary signal |
| ICR-W1 | High | W | Paynow rows used PAY-04's state words, which assume a provider that can cancel and expire. | Paynow-aware states and words on every surface, in the server and the client. | views (exhaustive), truth, screens, browser | No "nothing was paid" while Paynow reports money | None known |
| ICR-W2 | High | W | The label followed Paynow's word alone, whatever CarUp had done with the request. | A released or settled request is never "waiting", offers no link, code or form, and says not to approve it. "It still counts" removed. | views, truth, screens; matrix F9; browser | Words and actions agree | A customer can still approve the old prompt on the handset; Paynow cannot cancel it. CarUp re-reads before any new request |
| ICR-W3 | High | W | "Paid — confirmed by Paynow" came from Paynow's status, not from what CarUp counted. | "Paid" only when counted; otherwise "Paynow reports it paid", with allocation as a separate part. | views, truth; matrix F11 | Never confirmed unless counted | None known |
| ICR-W4 | High | W | Every O'mari failure used one "nothing changed" sentence. | Failures are classified: only Paynow's refusal is definite. A lost answer says Paynow may have taken the payment and to check first. | truth | Truthful for every failure class | Real OTP-after-timeout behaviour is a Level 2 question |
| ICR-P1 | High, **Level 2 gate** | P | Paynow's API carries no currency, and verification held one global tick-box. | Each integration's own reviewed settlement currency is required at verification, refused if it differs, and written once. Without it nothing begins, and in-flight money is a `currency_mismatch` review. No conversion. | smoke L1–L3; services "ICR-P1"; matrix M3 | Fails closed | **Remains a Level 2 gate:** how a settlement currency is proven, and reconciliation against real settlement, need Owner and Paynow |

## Medium (13)

| ID | By | Root cause | Correction | Regression | After | Residual risk |
|---|---|---|---|---|---|---|
| ICR-M4 | N, F | Cancelled or Failed after money was applied as a close, and a dispute could only end on a later Paid. | Cancelled or Failed after money is a review. A dispute can be settled outside CarUp at any time, or acknowledged once Paynow closed it; neither counts. A reviewed reversal can be released. | smoke D1–D3, D5; matrix F7 | Every review has an exit | A settlement relies on the operator's note; Paynow's later report is reviewed |
| ICR-M5 | F | The amount check ran before the dispute branch. | Disputed is always a dispute; the amount is evidence. | smoke D4; matrix F8 | Nothing can count it | None known |
| ICR-M6 | F, N | A Refunded of another figure was refused by the writer after being recorded as applied. | It applies as a full refund, keeps the figure as evidence, and an observation recorded as applied really was. | smoke F1, F2b; matrix F8 | Applied in full | A real partial refund is unknown: the operator confirms in Paynow's records |
| ICR-S1 | S | Duplicate detection hashed the bytes received, while Paynow's hash ignores padding and empty fields. | Same identity fix as ICR-M2; a per-collection budget for update-triggered reads; a real-mode result URL must be https. | services "ICR-S1"; views; protocol; matrix F4, F6 | Variants are one message; reads are bounded | A holder of a captured message can still cost twelve reads in ten minutes per collection |
| ICR-S2 | S | An ID was reserved on registration with no proof of its key, and the refusal revealed that it was in use. | The key is proved at connect, before anything is written, and the database requires that proof. One generic refusal. A rejected ID cools down, and repeated failed proofs stop probing. | smoke K1; services "ICR-S2"; matrix M5 | No squatting, no oracle | The proof relies on Paynow signing NotFound with the queried key (a Level 2 question) |
| ICR-P2 | P | Express requests carried the payer's e-mail in every mode; the simulator accepted any. | A `paynow_test` integration carries its merchant login e-mail. The simulator can enforce the rule. | smoke L5; views; adapter | Test-mode rule modelled | Real test mode unexercised (Level 2) |
| ICR-P3 | P | Whether `amount` includes customer fees is unknown. | Fail closed: a fee-inclusive amount stays an amount review. Real modes need a fee-handling attestation at verification. | smoke L4; services "ICR-P3" | Counts nothing | **BLOCKED:** Paynow's answer decides whether real payments would all be reviews |
| ICR-P4 | P | Returned hosts are unknown, and a request recovered by trace had no address for its O'mari code. | The allowlist is kept. A refused URL keeps the request recoverable. An O'mari request with no address says so instead of offering a form. A trace reply's page link is kept when Paynow names one. | adapter; services "ICR-P4"; screens | Never stranded silently | **BLOCKED:** real hosts need Paynow's answer |
| ICR-W5 | W | Controls unmounted while focused, and two results were inserted with their words. | Focus moves to the new content after each listed action, including every check (see CERT-2). Result regions are on the page before they speak. | screens; browser keyboard walks | Keyboard users keep their place | Real screen-reader output not tested |
| ICR-W6 | W | The panel offered release on state alone. | `can_release` and its reason come from the server and mirror the database's rules; the database still decides. | views; screens; browser | Offered only when allowed | None known |
| ICR-W7 | W | Means of payment vanished at CarUp's own time, though the amount stayed reserved. | The code, form and link stay while it is reserved; the stop warning says it stays reserved. | views, truth, screens; browser | No dead end | A trace-recovered hosted request has a link only if Paynow's reply names one |
| ICR-W8 | W | "Connected" followed any non-suspended merchant, and the simulator badge followed PAY-04's gateway only. | Connected means customers can pay through it; pending says so; rejected reads as not connected; a simulator-mode Paynow merchant shows the badge. | matrix M5; browser | Truthful | None known |
| ICR-W9 | W | PAY-04's words assume money moved. | Paynow rows read "in progress or under review and not counted"; PAY-04's rows are unchanged. | truth | Truthful | None known |

## Low (16)

| ID | By | Disposition | Correction or reason | Regression | Residual risk |
|---|---|---|---|---|---|
| ICR-M7 | N | Corrected | A word that moves a payment forward is never superseded by ticket order. | smoke G1, G2 | An older-ticket Refunded or Disputed applies; Paynow's next word governs |
| ICR-M8 | N | Corrected | A refusal after a concurrent trace can close the request. | smoke I1 | None known |
| ICR-M9 | F | Corrected | Money after a close is late money whatever its amount, and re-reserves nothing. | smoke I2 | None known |
| ICR-M10 | F | Corrected | One refund review per collection; a repeat after any closed review is recorded only. | smoke F2, D5 | None known |
| ICR-M11 | F, N | Corrected | An ID verified for one garage is refused to another; the same garage may reconnect. | smoke K2 | A genuine ownership transfer needs an operator and a reviewed path (Level 2) |
| ICR-S3 | S | Partly corrected | An ex-employee with a workforce record is refused. | smoke K3 | **Open (CERT-6):** a membership with no workforce record leaves no trace, and the independent certifier confirmed it. Closing it needs a membership history in Garage foundations, outside R1's boundary. |
| ICR-S4 | S | Tracked (Level 2) | The per-collection budget bounds reads. Limiter buckets need Paynow's source addresses and real traffic. | services "ICR-S1" | Status updates share one per-IP bucket; a 429 makes Paynow resend |
| ICR-S5 | S | Tracked (**Level 2 blocker**) | KEK rotation needs a design for immutable sealed columns. | none at Level 1 | A KEK change strands integrations; the resulturl stays uniform, and reads fail closed |
| ICR-S6 | S | Corrected | Before a signature is proved, a key that cannot be opened answers as any other refusal. | services "ICR-S6" | None known |
| ICR-P5 | P | Corrected | The poll URL binds by canonical comparison: case and encoding are not another payment. | services "ICR-P5"; protocol | None known |
| ICR-P6 | P | Kept, pinned | Paynow's published vector needs trimmed values, and identity now collapses padding. | adapter "ICR-P6"; services "ICR-S1" | Whether real inbound values carry spaces is a Level 2 question; a mismatch fails closed |
| ICR-W10 | W | Corrected | `hold_released` and `system:expiry` read as words; the "stopped or closed" event label. | truth; screens | None known |
| ICR-W11 | W | Corrected | No raw code or browser text reaches a person; operators keep the code beside the words. | truth | None known |
| ICR-W12 | W | Corrected | One idempotency key per thing asked for, so editing and restoring retries the same request. | screens | None known |
| ICR-W13 | W | Corrected | Disabled controls say why, tied to the field and the button. | screens | None known |
| ICR-W14 | W | Corrected | An unconfirmed request is said to be unconfirmed. | truth | None known |

## Informational (11) and documentation (2)

| Item | Disposition |
|---|---|
| GCM tag length not pinned in code | Corrected (`authTagLength: 16`), with a truncated-tag test |
| Key fingerprint is an unkeyed hash prefix | Kept: keys are high-entropy, and a keyed digest would tie it to the KEK. Recorded |
| Identity sequences not revoked | Corrected; smoke N3 |
| Disconnect audits a dual-role person as `admin` | Corrected: the garage path acts as the garage |
| The garage view shows operators' IDs and notes | Corrected; services "ICR Info" |
| A `super_admin` who is not a platform admin is probed before the database refuses | Kept: no money or key effect; the database refuses. Recorded |
| Late binding leaves the intent NULL and marks closed although nothing closed | Kept: money is correct. Recorded |
| The webhook accepts only form-urlencoded | Kept pending Paynow's answer (Level 2 question 7) |
| The 46-character reference | Kept pending Paynow's answer |
| Test-mode Paid is indistinguishable from real Paid | Kept: real modes are off by constraint; a Level 2 item |
| The credential probe assumes NotFound is signed with the queried key | Kept: an unverifiable reply is never "authenticated". A Level 2 question |
| Documentation: the replaced-function count | Corrected (11) |
| Documentation: the capability matrix's "Failed" row | Corrected |

## Pre-final adversarial review (PFR)

No hard invariant broke in that review: paid never exceeded an invoice's total, and receipts always equalled what counted. These were
correct sums reached by the wrong word, and second payments invited. Each was reproduced by the reviewer, confirmed against the code by the
remediator, failed its new test at commit `1a902df6`, and passes after correction.

| ID | Sev. | Root cause | Correction | Regression | After | Residual risk |
|---|---|---|---|---|---|---|
| PFR-H1 | High | Closed and unknown words had rank 0, so any money word counted as forward against them, even from an older read. | Nothing moves past a newer closed or unknown word except a newer read. A recorded-only read still moves the ticket. | smoke R1, R1b, R1c, R1d, R1e | An older Paid is superseded; Paynow's own newer Paid counts | A ticket orders asking, not answering: a real Paid answered later on an older ticket waits for the next read, which every view, update and start makes |
| PFR-H2 | High | The release check ignored recorded-only reads and refused a reviewed unknown word, so a closed review left the room held forever. The words said "nothing was charged" and "complete this request". | A re-read refreshes the check; a reviewed unknown word can be released; a new `reviewed_held` state says what is true. | smoke R2, R3; services "PFR-H2"; views; truth; matrix G4 | The room can always be freed | None known |
| PFR-H3 | High | Paying again looked only at released and settled requests, so a closed request's late money under review did not stop a new one. | A review of money that holds no room, on any request of the invoice, refuses a new request. | services "PFR-H3"; matrix G1 | No second payment while a review stands | A request that holds its own room still lets the customer pay the rest of the invoice |
| PFR-H4 | High | Late money counts into room another request only reserves, which is correct: a reservation is not money. The other request kept asking to be completed. | Decided and documented (§5.5). The request now reads `no_longer_needed`, with no link, code or form, and its own money is unallocated. | views; services "PFR-H4"; truth; matrix G2 | Not invited; never counted twice | Paynow cannot cancel it: a customer can still approve an old handset prompt, and an operator then reviews that money |
| PFR-H5 | High, inherited | The operator's queue took the oldest 200 attached requests and only then filtered for pending. | The queue is chosen in the database and reports its total. | smoke R12; services "PFR-H5"; screens | A stuck request is always in reach | Past 200 stuck requests the panel says so |
| PFR-M1 | Medium | A hold Paynow keeps in escrow or cannot be read for had no exit: release, cash and void were all refused, with no review to settle. A settled request that could not be read also refused new requests. | An operator can open a review past CarUp's time, which needs no read and counts nothing; settling it frees the room. A settled request's read failure no longer refuses. | smoke R4, R5; services "PFR-M1"; views; screens; matrix G3 | Every hold has an exit | A settlement relies on the operator's note; Paynow's later money is reviewed |
| PFR-M2 | Medium | Two deliveries of one message share one event, so the later read was thrown away when an older read wrote first, with a 200. | A duplicate whose read differs from the held word is evaluated as the poll it is. | services "PFR-M2" | The news is applied | None known |
| PFR-M3 | Medium | One budget per collection let a replay starve a genuine message, and each replay wrote rows. Paynow's hash covers a bare concatenation, so a message can be re-split across fields. | A budget per message, sixty across messages, and no row for a recorded message showing nothing new. A re-split message has the same identity. | smoke R7, R7b, N2; services "PFR-M3"; matrix F6 | No rows, and no starvation by another message within the overall budget | A holder of a captured message can delay a genuine repeat of that same message by up to ten minutes; enough distinct captured messages can spend the overall budget for a window; ordinary reads still see it |
| PFR-M4 | Medium | Room freed on one collection did not re-project another collection's waiting money. | A drop in what counts re-projects waiting Paynow money on the invoice, oldest first. | smoke R6, R6b; services "PFR-M4" | Counts at once, with its receipt | That customer gets no separate notification; the invoice shows it (see PFR-L8) |
| PFR-M5 | Medium | A closed request whose word was missing or pending fell back to waiting words, and paying again gave no warning about a request Paynow still had. | Closed states have their own words; only a payable state offers a link, code or form; a late-bound request is `closed_live` and warns on paying again. | views; services "PFR-M5"; truth; matrix G5 | Never reads as waiting | None known |
| PFR-L1 | Low | A resend of the latest message was a duplicate though a read of another amount came between. | A duplicate also requires the amount CarUp last read. | services "PFR-L1" | Read again | None known |
| PFR-L2 | Low | Refunded on a closed payment with no money seen was recorded only; the state could still say no money was reported. | The operator is always told; the state reads refunded. | smoke F3; views | Told | None known |
| PFR-L3 | Low | A partial count read as "not counted". | `confirmed_partial` says the part. | services "PFR-L3"; views; truth | Truthful | None known |
| PFR-L4 | Low | The check-status message spoke from Paynow's word before CarUp's state. | The state speaks first. | truth | Truthful | None known |
| PFR-L5 | Low | "Last read" followed changes of word, not reads. | A separate time, moved by every read that repeats what CarUp holds. | smoke R9; services "PFR-L5"; views | Truthful | None known |
| PFR-L6 | Low | A stop by the garage read as "You stopped waiting". | The sentence no longer says who. | views | Truthful | None known |
| PFR-L7 | Low | The customer's stop answer carried the garage's next step. | The customer's answer carries the customer's words. | services "PFR-L7" | Truthful | None known |
| PFR-L8 | Low | The customer is told when money counts, but not when it stops counting. | **Tracked, not corrected.** A new notification needs a governed template in Communications, outside R1's boundary. | none | The invoice itself says it | A customer not looking at the invoice learns later |
| PFR-L9 | Low | A canonical `paid` row that no longer counts blocked voiding the invoice. | It no longer blocks once settled or once Paynow's latest word is not Paid; open reviews still refuse; later money never counts on a void invoice. | smoke R11 | Not a dead end | None known |
| PFR-L10 | Low | A former garage worker now an operator could close that garage's reviews. | Refused on closure, release and opening a review, as at verification. | smoke R10 | Refused where a workforce record exists | As ICR-S3: a membership with no workforce record leaves no trace |
| PFR-L11 | Low | The operator's free-text currency reference reached the garage. | Removed from the garage's view. | services "PFR-L11" | Stays with operators | None known |
| PFR-L12 | Low | Operators' failed probes counted against the garage's connection; the cool-down is check-then-act. | Only the garage's own failed connections count. **Partly corrected:** a parallel burst is bounded by the per-IP limiter, not the cool-down. | services "PFR-L12" | A correct key is not refused | A burst of connects can send several probes before failures are recorded |
| PFR-L13 | Low | Reads that failed lost the slow pace, because pacing used recorded observations. | Every attempt is timed. | smoke R9; services "PFR-L13" | One attempt per window | None known |

Also found by the remediator, in the physical rehearsal and by re-running that reviewer's state walkers on the corrections:

| ID | Sev. | Root cause | Correction | Regression | After | Residual risk |
|---|---|---|---|---|---|---|
| PHY-1 | Medium | At 390 px the refresh after Pay drew the request in the invoice's list above the checkout, pushing the O'mari form well below the fold. R1's facts made that list about 560 px tall. | The way to pay comes before the invoice's lists. | browser (O'mari, InnBucks at 390 px); screens | Stays on screen | None known |
| PHY-2 | Medium | Inside a started request, the separate facts sat above the InnBucks code and the O'mari form, and the first read inserted them after the code was on screen. The same facts also appeared three times on one card. | The started request keeps its means of payment together and scrolls to the top of the screen. Its facts are in the list of payments directly below. In that list too, the means of payment comes first. | screens; browser (390 px) | Stays on screen | None known |
| WLK-1 | Medium | Introduced by the correction of PFR-H1: a superseded money word no longer counted as money seen, so a later Cancelled closed the payment as if no money had been reported. | Money seen counts every recorded word; the first report of money is kept on the request; a closed request Paynow reported money on reads as such. | smoke R1f; views | A review, never a quiet close | None known |
| WLK-2 | Medium | An operator could acknowledge a review while Paynow's latest word reported money, which freed the invoice for a second payment while Paynow held the first. It also meant "acknowledged" could count a fresh Paid. | Refused while Paynow's latest word reports money: settled outside CarUp, or Paynow corrects it. | smoke R1g, B3b | No second payment invited | Paynow staying in escrow keeps the review open until an operator settles it; cash remains possible once settled |
| WLK-3 | Low | On a closed payment with late money, a newer Cancelled was recorded only, so the word on screen stayed Paid beside a fresh read time. | Once money was reported on it, newer words are evaluated. | smoke R1g | The word and its time agree | None known |
| SCR-1 | Medium | Found by reading the screenshots, after every automated check passed: a part-counted request CarUp had released told the garage and operators it was "not counted", beside a fact saying what counted. | The part-counted state speaks before the released one. | truth; browser | Truthful | None known |
| SCR-2 | Low | The stop question and notice said "if you do not complete it, nothing is charged" to someone who may already have paid. | The promise is gone: it says the request can still be completed. | views; screens; browser keyboard | Truthful | None known |
| SCR-3 | Low | Found by reading the operator screens: the operator read the garage's next step, addressed as the garage ("record what you really received", "unless the customer really paid you"). | The operator list has its own wording for those states, saying what the garage should do. | views; services | Truthful | None known |
| SCR-4 | Low | Found by reading the operator screens at the frozen commit, after every automated check passed: opening a review added the raw code `review_opened` to the merchant history. R1 added the event without its words. | The event has a sentence, and an unknown event reads as a recorded change, never a code. | lib words; browser keyboard | Truthful | None known |
| CERT-1 | Medium | Found by the independent certifier, at this code and at the frozen head: when Paynow disputed a payment it had refunded, reprojection closed the dispute in Paynow's name, in the same call that opened it. Nothing counted wrongly, but no operator saw it and the audit row credited Paynow with a statement it did not make. | For Paynow money, a refund closes reviews only when Paynow's own latest word is Refunded. The dispute stays open, holds its room and reads as under review. | smoke R13, R13b; services "CERT-1"; matrix G6 | The dispute reaches an operator | How often Paynow sends this sequence is a Level 2 question |
| CERT-2 | Medium | Found by the independent certifier: "Check payment status" disables itself, so focus fell to the page, and a check that paid the invoice in full removed the panel about 0.4 s later. | The answer takes the focus. When the way to pay goes away with focus lost, the invoice says nothing is left to pay and takes it, without taking focus from anywhere a person has moved to. | truth; browser keyboard at phone and desktop | Keyboard users keep their place | Real screen-reader output not tested |
| CERT-3 | Low | Found by the independent certifier: `refunded_to_customer` skipped the rule refusing to close a review while Paynow's latest word reports money. | The same refusal applies. | smoke R14; matrix G7 | Refused | None known |
| CERT-4 | Low | Found by the independent certifier: an invoice could be voided with a review open on a settled request, although this matrix said open reviews refuse. | They now do, except a refund to confirm, which is money already gone. | smoke R15, R15b; matrix G7 | Refused until the review closes | None known |
| CERT-5 | Low | Found by the independent certifier: the customer was told "The garage and CarUp have been alerted", but no alert is sent. PFR-L8 stays tracked. | The words say the garage and CarUp can see it, which is true. Also corrected on PAY-04's identical line. | truth | Truthful | As PFR-L8 |
| CERT-7 | Low | Found by the independent certifier: two of its mutants survived the R1 smoke: the void guard's settled term, and CERT-1's closure. | Both are now tested. | smoke R13, R15b; mutants | Killed | None known |
| Certifier's informational notes | Info | A closed request's badge claimed Paynow reported it cancelled even if it was never sent. Enough distinct captured messages could spend a collection's overall read budget for a window; ordinary reads are unaffected. | The badge is corrected. The budget is recorded as a bounded residual. | views | Truthful | The read budget stays as stated |
| SLF-1 | Low | Introduced and caught during the same correction round: timing a read inside the ticket function put a row lock in front of the writers' lock order, and 70 deadlocks appeared in the reviewer's race script when a caller combined both in one statement. | The time is recorded in its own call; the frozen ticket function is unchanged. | smoke R9; the reviewer's race script: 60 rounds, 0 deadlocks | No lock-order hazard | None known |

## Cross-program test guard

| Item | Correction | Regression |
|---|---|---|
| O2-X4 fingerprint guard (cross-program security test guard defect) | The exclusion is gone. A SQL file under `database/` that names a fingerprint anywhere, comments included, passes only if it is on a closed list of 9 reviewed files, matched by SHA-256 at its exact path. A `U&` name or string is refused anywhere else. The list holds the one approved schema node (this table, this exact declaration, once, checked by a test), the file that writes, compares and audits that digest and declares nothing, and older non-biometric meanings: Trust's presentation hash, a concurrency token over trust columns, a device identifier, an evidence hash. **For the Moderator:** the exception is a whole reviewed file, not a column as the directive worded it. It admits less than a column-level rule, and no occurrence is removed from any file, but it is a substitution to accept or refuse. Three independent reviews ran; two refused word-level and line-level versions. None is the O2 owner's sign-off, which remains outstanding. Limits: it reads names, so these are not seen: a copy or exposure that never names the column (`LIKE`, `INHERITS`, `SELECT *`, a whole-table grant, `to_jsonb(row)`), some of which create a column named exactly `credential_fingerprint`; dropping the column's CHECK or changing its type through a catalog lookup; a name assembled from pieces or from string escapes (`E'\x69'`, `decode`) in dynamic SQL; another spelling such as `finger_print`; biometric words outside the two patterns (`minutiae`, `face_template`), as at the frozen head. The older reviewed columns are unbounded text: a pin covers their declaration, not what they hold. SQL outside `database/`, and files not ending `.sql`, are not scanned. Anyone can recompute a hash, so a re-pin relies on reviewing the guard's diff; there is no CODEOWNERS file. Other programmes feel this: a new migration mentioning the word fails until reviewed, and its message says where to list it. Biometric architecture is not touched. The earlier statement in `CARUP_PAY_05_FINAL_CERTIFICATION.md` that the guard names two fingerprints where CHECK-pinned describes the removed mechanism, and is left as the frozen record. | `backend/tests/o2-x4-biometric-interface.test.js`: the Moderator's two-table fixture, each reviewed file with one more byte, emptied, copied or renamed, a moved or disabled reviewed line, a selection of the forms from the reviews that contain the word, `U&` escapes, Trust's names in and out of its files, the two biometric patterns pinned by source, and the sweep reaching each listed file |

## Deliberate changes to accepted tests

These assertions changed because R1 corrects what they pinned. Nothing else in an accepted test changed.

| Test | Change | Why |
|---|---|---|
| PAY-05 smoke, fixtures | Registration carries the connect probe; verification carries per-integration currency evidence | ICR-S2, P1 |
| PAY-05 smoke | `PAY05_INTEGRATION_ALREADY_REGISTERED` → `PAY05_INTEGRATION_NOT_ACCEPTED` | ICR-S2: one generic refusal |
| PAY-05 smoke | `settled_off_platform` on a dispute no longer refused; `acknowledged` is what stays invalid while Paynow says Disputed | ICR-M4: a silent dispute needs an exit |
| `pay05-paynow-services.test.js` | A wrong key is refused at connect, not at verification; fixtures as above | ICR-S2, P1 |
| `pay05-paynow-views.test.js`, `pay05-paynow-protocol.test.js` | The Paid label; the event-identity signature | ICR-W3, M2 |
| HTTP matrix M2, M3, M4, M5 | As above; M5 now covers the cool-down and the merchant's status on the garage page | ICR-S2, P1, W8 |
| Web tests in `pay05Paynow.test.ts`, `PaynowOperatorPanel.test.tsx`, `PaynowConnection.test.tsx` | Fixtures and words | ICR-W3, W6, W11, P1, S2 |
| `garageCaseHub.test.tsx` | The notice region is always on the page, empty until it speaks | ICR-W5 |
| `o2-x4-biometric-interface.test.js` | The exception replaced as above | Moderator, issue #255 |
| R1 smoke F3, services "ICR-S1", matrix F6 | R1's own tests, changed by the pre-final review: a Refunded on a closed payment tells the operator; budgets are per message | PFR-L2, M3 |
