# Rehearsal at f3b1cf53

The full physical run passed at this commit: PAY-05 HTTP 59/59, PAY-04 HTTP 26/26, PAY-04 browser 9/9, PAY-05 browser 12/12, R1 state truth and keyboard 18/18, ICR keyboard 3/3.

Reading its screenshots afterward found SCR-4: the merchant history showed the raw code `review_opened`. No automated check caught it. It was fixed test-first, the commit was replaced by fae78416, and every run was repeated there.
