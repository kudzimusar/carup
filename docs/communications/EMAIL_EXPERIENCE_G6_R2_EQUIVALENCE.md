# G6 — R2 password reset, migrated and proven equivalent

Part of CarUp Email Experience & Design System 1.0. Follows G0/G1/G3/G2/G4/G5 and
[G12](EMAIL_EXPERIENCE_G12_PUBLIC_PREREQUISITES.md).

## What "equivalent" has to mean

`authEmailTemplates.js` was **physically certified**: a human received it, in a real inbox, and
accepted it. Replacing it with a second renderer is only safe if the replacement holds every property
that made the certified artefact acceptable — and "it looks fine to me" is not a property.

Byte-equality is impossible and was never the goal. The B1 identity freeze supersedes the certified
sign-off line, and the canonical footer links `/support` and `/privacy` — real routes that did not
exist when the original was certified. What must survive is the **substance**.

## The contract

`emailExperience/authEquivalence.js` declares 16 invariants, each a property a customer relies on:

| | |
|---|---|
| `subject_identical` | not "similar" — the exact line someone scans an inbox for |
| `html_document`, `mobile_safe_width`, `hidden_preheader` | the shell every mail client agreed on |
| `accessible_action_colour` | `#C2410C` (~5.2:1), never the UI's `#F97316` (~2.9:1, fails WCAG AA) |
| `action_is_clickable` | exactly one anchor — without it the Email is a paragraph about a reset the reader cannot perform |
| `action_is_also_copyable` | repeated as visible text, as the certified layout does, for a client that strips the button |
| `action_escaped_exactly_once` | G1 — `&amp;amp;` is a link the customer cannot paste |
| `action_url_not_mangled` | the escaped href decodes back to the URL that was issued; one altered character is a reset that silently fails |
| `security_note_present`, `no_action_expected_reassurance` | single use, expires within the hour, current password stays active, and the line that stops someone panicking about a reset they did not request |
| `reason_received_present` | |
| `plain_text_carries_full_meaning` | CarUp's own rule — a text part saying "view this in HTML" has lost what made it a security Email |
| `no_marketing_control`, `no_invented_identity`, `no_unrouted_or_foreign_link` | |

Invariants are expressed against the **certified artefact** where possible, not against constants
copied out of it — a constant would silently stop describing the certified output the moment that
output changed.

## The guard runs on every send

Both renderers run, and the canonical artefact is only used if it passes. That is deliberate: the
certified artefact is the specification, so the only honest way to say "the canonical one is
equivalent" is to produce both and compare them on every send.

A guarantee asserted once in a test file protects the build. A guarantee evaluated on every send
protects the customer.

```text
canonical render passes    ->  canonical artefact ships,  render_fallback_used: null
canonical render refused   ->  CERTIFIED artefact ships,  render_fallback_used: auth_equivalence_failed
template not migrated      ->  CERTIFIED artefact ships,  render_fallback_used: auth_compatibility
```

The two decline reasons are kept apart on purpose. *Not eligible* means the canonical artefact was
never attempted — a producer supplied no action URL, so there was nothing to compare. *Equivalence
failed* means it **was** produced and did not hold a property the certified one holds. Collapsing them
would send whoever reads the audit trail hunting a rendering bug that is really a missing field, or
worse, the reverse.

## Copy has one source

`AUTH_EMAIL_COPY` is exported from `authEmailTemplates.js` and read by **both** renderers. That is the
failure mode a "migration" usually has: two templates that agree on the day they are written and
slowly stop agreeing. `B8` asserts every line appears in both artefacts.

## The wiring trap this closed

The Resend adapter preferred `resolveAuthHtml` **unconditionally**. Left that way, the migration would
have been invisible: the canonical artefact produced, verified equivalent, and then silently
discarded at the transport boundary while the certified one shipped.

Precedence is now: the renderer wins when it produced HTML — for a migrated template it has already
proven equivalence — and `resolveAuthHtml` remains the fallback for everything else. `D1` asserts the
bytes on the wire are the canonical render and **not** the certified one.

## One template, not three

`CANONICALLY_RENDERED_AUTH_TEMPLATES` is `['reset_password']`. `confirm_signup` and
`password_changed` stay on the certified path until each has its own equivalence proof. Migrating
three P0 flows because one of them was proven is how a careful migration becomes an outage.

## What G4 predicted, now observable

G4 said `auth_compatibility_html_used` would be the field that shows the migration actually happened
rather than being assumed. It is:

| | R2 (migrated) | `confirm_signup` (not migrated) |
|---|---|---|
| `html_source` | `renderer` | `auth_compatibility` |
| `auth_compatibility_html_used` | `false` | `true` |
| `auth_equivalence_verified` | `true` | `false` |

`E2` asserts those land on the persisted delivery attempt through the real worker.

## Secret safety holds

The reset token reaches the inbox and nothing else. `E1`/`E2` assert it is absent from renderer
provenance, send provenance and the persisted delivery attempt; `cta_route: '/auth/reset-password'`
proves which flow ran without carrying the credential. Mutant 7 restores the full tokenized URL and
kills six tests.

## The certified path is preserved, not deleted

G2 §I stands: architecture neatness does not get to risk a password reset. `resolveAuthHtml` remains
reachable and exercised, and `authEmailTemplates.js` still renders all three templates. **Retiring it
is a separate, owner-gated decision** and is not taken here.

## Mutants — seven, all killed

| # | Mutant | Killed |
|---|---|---|
| 1 | skip the equivalence check and ship the canonical render regardless | 1 |
| 2 | restore the adapter preferring `resolveAuthHtml` | 3 |
| 3 | drop the `subject_identical` invariant | 1 |
| 4 | drop the `action_escaped_exactly_once` invariant | 1 |
| 5 | migrate all three auth templates at once | 1 |
| 6 | collapse the two decline reasons | 4 |
| 7 | put the reset token back into CTA provenance | 6 |

**Mutants 1 and 4 survived their first run, and that was a finding about the tests.** The suite proved
the guard *works* (`C1` drives it directly) but not that the renderer *consults* it — so the check
could have been deleted with every test still passing. `C1b` was added: it feeds a real producer bug
(an action URL that already contains an HTML entity, which escapes to `&amp;amp;`), and asserts the
canonical artefact is refused, the certified one ships, and the failure is recorded as *equivalence
failed* rather than *never attempted*. Both mutants die against it.

## Regression

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (G12 head `5a2667b5`) | 4521 | 4500 | 0 | 21 |
| With G6 | 4542 | 4521 | 0 | 21 |

Delta exactly +21 — the new equivalence suite. Communications/Email/auth: 610 pass, 0 fail.

## Existing tests reclassified

`O1` in the G4 suite used `reset_password` as its example of the compatibility path. G6 migrated it,
so it is no longer an example of that path; it now uses `confirm_signup`, which is deliberately
unmigrated and is therefore the honest example. `M1` in the renderer suite asserts the exact
provenance key set, which gained `auth_equivalence_verified`. Nothing was rewritten to reach green.

## Status

```text
G6_R2_SOURCE_EQUIVALENCE_PROVEN
G6_PHYSICAL_RESET_DELIVERY_PENDING_STAGING
```

Deterministic equivalence against the certified artefact is proven at source. That is **not** a claim
that a human has received the canonical reset Email. Physical certification must still show a real
password reset delivered from the canonical renderer, opened, and completed.

`PRODUCTION_COMMUNICATIONS=INACTIVE` throughout. No deploy, no DNS, no provider change.
