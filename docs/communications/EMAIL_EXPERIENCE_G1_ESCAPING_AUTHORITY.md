# G1 — One escaping authority

Part of CarUp Email Experience & Design System 1.0. Closes the second runtime gap identified in
`CARUP_EMAIL_EXPERIENCE_DESIGN_SYSTEM_1_0_CANONICAL_PLAN.md`.

## The defect

Both template paths HTML-escaped variable values while building the **canonical plain text**:

```js
// communicationTemplateService.js and communicationGovernedTemplateService.js — before
const replace = (text) => text.replace(/\{\{(\w+)\}\}/g, (_m, k) => escapeValue(variables[k] ?? ''));
```

`escapeValue` applied the five HTML entity substitutions to `subject`, `body` and `text` alike.

Two customer-visible consequences, in opposite directions:

1. **text/plain and the subject header carried HTML entities.** A reader of the plain-text part saw
   `Automotive Intelligence &amp; Trust Network`. A subject line is not an HTML document at all, so
   there was never a layer that would decode it.
2. **A correct HTML producer escaped it a second time.** `escapeHtmlText` at the provider adapter's
   HTML boundary does its job correctly — given `&amp;` it produces `&amp;amp;`, which renders to the
   customer as the literal text `&amp;`.

The premature escaping also made escaping *unconditional on representation*, which is what let both
outcomes coexist: substitution cannot know whether its output is destined for a subject header, a
text part, or an HTML document, so it is the wrong place to decide.

## The ownership rule

One authority per representation, applied where that representation is built:

| Representation | Who escapes | Where |
|---|---|---|
| plain text, subject | nobody — literal characters are preserved | `templateVariableSubstitution.js` |
| HTML | escape exactly once | `escapeHtmlText` (`adapters/providerAdapters.js`), `escapeHtml` (`authEmailTemplates.js`) |
| URL | encode per URL semantics | `buildUnsubscribeUrl` (`encodeURIComponent`) |
| provider JSON | JSON serialization only | the adapters' `requestJson` |

## What changed

- **New** `backend/services/communication/templateVariableSubstitution.js` — the single substitution
  function, documented with the table above. It uses a replacer *function*, so `$&`/`$1` inside a
  value are not reinterpreted and a substituted value is never rescanned for further placeholders.
- `communicationTemplateService.js` and `communicationGovernedTemplateService.js` both delegate to
  it; `escapeValue` is deleted from both.
- `adapters/providerAdapters.js` — the marketing unsubscribe **receipt** now searches the HTML for
  the href as the HTML actually carries it (escaped once) rather than for the raw URL. See below.
- **New** `backend/tests/email-experience-escaping-authority.test.js` — 9 tests.

The HTML boundaries were **not** changed. They were already correct; the defect was that something
upstream had already escaped.

### The receipt fix

`marketing_html_anchor_present` compared the raw unsubscribe URL against HTML that contains the
escaped one. It matched only because the URL currently has a single query parameter and a base64url
token — no `&`, `<`, `"` to escape. Adding a second query parameter would turn the href into
`…?token=t&amp;campaign=c`, the raw-URL search would miss, and the receipt would report **no
unsubscribe control** on a message that carries one. A compliance receipt that lies in the direction
of a false violation is worth fixing before it can fire, not after.

## Anti-vacuity: three source mutants, all killed

Each mutant was applied to the source, the suite run, and the source restored.

| # | Mutant | Result |
|---|---|---|
| 1 | Restore the old premature HTML-escaping inside `substituteVariables` | **7 of 9 fail** — all plain-text tests, and both HTML tests via `&amp;amp;` |
| 2 | Remove `escapeHtmlText` from the HTML paragraph builder | **3 of 9 fail** — the double-escape test, the injection test, and the anti-vacuity guard |
| 3 | Revert the receipt to comparing the raw URL | **1 of 9 fails** — `RECEIPT: a multi-parameter unsubscribe URL…` |

Mutant 2 matters specifically because an HTML assertion can pass by never producing HTML. The
`ANTI-VACUITY` test pins that separately: the synthesized HTML must exist, be the synthesized form
rather than the raw body, and differ from the text part.

## Existing tests reclassified

`backend/tests/auth-email-templates.test.js:64` asserts `&quot;`/`&lt;script&gt;` appear in output.
That is a genuine **HTML boundary** assertion — `renderAuthEmail` returns an HTML document, and the
escaping there is `escapeHtml` in `authEmailTemplates.js`, a different renderer that never used the
substitution path. Preserved unchanged.

No other backend test asserted HTML entities. Nothing was rewritten to reach green.

## Regression

Run under the CI environment contract from `.github/workflows/ci.yml` (`NODE_ENV=test`, placeholder
Supabase/JWT values, `ALLOW_OCR_MOCK=true`).

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Baseline (`d9e1869c`, G1 changes stashed) | 4366 | 4345 | 0 | 21 |
| With G1 | 4375 | 4354 | 0 | 21 |

Delta is exactly +9 — the new tests — with no failure anywhere. Communications/Email focused suites:
388 pass, 0 fail.

The lint baseline gate scopes ESLint to the `web/` workspace; G1 touches backend only, so it carries
no lint delta.
