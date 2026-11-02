# PAY-05 independent review at 37cb5c5c — consolidated register and triage

Four independent read-only reviewers (fresh agents, given the code and the directive, not the author's conclusions),
2026-11-02. Scopes: DB money model (D), backend security (S), Paynow protocol fidelity against the saved Paynow docs
(P), web UI truth/accessibility (W). No Critical. Prefix = reviewer; number = their finding number.

## Themes and disposition (all FIX unless marked DOC = documented Level 2 / activation prerequisite)

### A. Read ordering and applied-status truth
- D1 (High) stale Paynow reads applied out of order change money: a lagging `sent` after `paid` opens
  provider_status_unrecognized and reverses the allocation; a stale `paid` after `disputed` auto-closes the dispute.
  FIX: DB read tickets taken before every Paynow read; older-than-applied reads are recorded as superseded, no effect;
  pre-payment statuses after payment are stale regressions (recorded, ignored).
- W5 / D1-side-effect (Medium) provider_status overwritten before refusal branches -> UI shows green "Paid" for a
  refused/under-review observation, "Cancelled — nothing was charged" for counted money. FIX: update provider_status
  only when applied; UI tone/label from the collection state.
- D7 = P7 (Low) duplicate shortcut compares the trigger hash, not the applied status. FIX.

### B. Late money and stuck states
- P1 (High) = D2 = S2 (Medium): a signed late Paid for a refused / traced_absent / closed-before-attach collection ->
  409, no observation, no discrepancy, no provider error. FIX: late attach + provider_paid_after_close review.
- S1 (Medium) Paynow refusal racing a stop leaves payment pending forever (refused + pending, no exit). FIX.
- P2 (Medium) no exit from sending/unknown when the trace never succeeds. FIX: operator closure after expiry with a
  fresh trace attempt; late money then caught by B.
- D3a (Medium) a Paid with a different amount jams the invoice (no operator exit). FIX: settled_off_platform for a
  Paynow amount_mismatch closes and releases.
- D3b (Medium, plausible) Refunded with an unparseable amount rolls back silently. FIX: record + review.
- S6 (Low) trace attaches before checking the reference. FIX.  S7 (Low) early attach loses the reply's browser URL /
  OTP URL / InnBucks code. FIX.  S8 (Low) local adapter refusal after the durable intent becomes 'unknown'. FIX.

### C. Operator / garage controls
- D4 (Low) PAY-04 suspend / refund writers accept Paynow rows. FIX (DB refuses).  D5 (Low) availability not enforced
  at sending. FIX.  D6 (Low) hold-release freshness ignores status-update / OTP reads. FIX.  D9 (Low) 'acknowledged'
  unreachable in the backend allowlist. FIX.  S3 (Low) PAY-05 kill switch not applied to Paynow work dispatched from
  PAY-04 routes; GET /api/pay05/garage/paynow lacks requirePay05. FIX.  S4 = W12 (Low) customers receive the
  garage/operator Paynow view. FIX.  S5 (Low) result URL existence oracle + unthrottled provider-error rows. FIX
  (uniform refusal; throttled rows).  S9 (Low) probe evidence copied not derived; probes before separation check. FIX.
  S10 (Low) customer GET drives Paynow calls for released/abandoned checkouts indefinitely. FIX (skip released;
  throttle).  W9 (Low) garage never sees the rejection reason. FIX.  W10 / W11 (Low) operator copy, expiry display,
  audience labels, audit history not rendered, red alerts when PAY-05 is off. FIX.

### D. Protocol fidelity (P)
- P3 (Medium) Paynow reports no currency: currency binding is CarUp's label only. FIX: operator verification requires
  a currency-configuration review per integration; DOC the limitation (cannot be provider-verified).
- P4 (Medium) test mode requires authemail = the merchant's login e-mail. DOC (Level 2; paynow_test unreachable).
- P5 (Low) values not trimmed in the hash; key not normalised. FIX.  P6 (Low) URL refusal misclassified as forgery;
  64 KiB cap after full buffering. FIX; host allowlist DOC.  P8 (Low) InnBucks phone FIX; 45 s initiation timeout FIX;
  SDK statuses "Created but not paid" / "Awaiting Redirect" FIX (pending, never money); NotFound hash formula DOC.
- Simulator divergences that mask: express initial status (needs_otp must accept created|sent) FIX; error-with-
  transaction then paid FIX (test); InnBucks phone FIX; test mode/currency DOC.

### E. Web
- W1 (High) express pending panel unmounted after Pay (parent reload sets 'loading'). FIX.
- W2 (High) no resume of Paynow page / InnBucks code / O'mari OTP for an existing payment. FIX (trace-recovered web
  request has no browser URL: DOC, Paynow's trace returns none).
- W3 (Medium) idempotency key discarded on ambiguous failures. FIX.  W4 (Medium) garage stop copy promises a cancel.
  FIX.  W6 (Medium) key field is type=password (password-manager capture). FIX.  W7 (Medium) disabled Connect with no
  reason, errors not linked. FIX.  W8 (Medium/Low) focus loss, pre-filled live regions. FIX.

### F. Test infrastructure
- D8 (Low) drift test: first definition only, unqualified names, ALTER/DROP, dynamic CHECKs/index. FIX.

## Not defects / accepted
- D Q7: simulator money shares gateway paynow_zimbabwe — simulator is enabled only in disposable databases (CHECK +
  local alignment); DOC.  D Q4: a pending registration can squat an integration ID — the probe fails for a squatter
  and the operator rejects it; DOC.
