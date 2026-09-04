/**
 * G6 — what it means for a canonically-rendered auth Email to be EQUIVALENT to the certified one.
 *
 * `authEmailTemplates.js` was physically certified: a human received it, in a real inbox, and
 * accepted it. Replacing it with a second renderer is only safe if the replacement holds every
 * property that made the certified artefact acceptable — and "it looks fine to me" is not a property.
 *
 * Byte-equality is impossible and is not the goal. The B1 identity freeze supersedes the certified
 * sign-off line, and the canonical footer links `/support` and `/privacy` — real routes that did not
 * exist when the original was certified. What must survive is the SUBSTANCE: the same subject, the
 * same action reachable the same two ways, the same security meaning, the same brand, the same
 * escaping, and nothing marketing.
 *
 * This runs at RENDER TIME, not only in tests. A guarantee that exists only in a test file protects
 * the build; a guarantee that runs on every send protects the customer. If a future edit breaks an
 * invariant, the renderer falls back to the certified artefact instead of shipping a password reset
 * nobody checked.
 */

const HIDDEN_PREHEADER = 'display:none!important';

/** Count non-overlapping occurrences of a literal. */
function occurrences(haystack, needle) {
  if (!needle) return 0;
  return String(haystack || '').split(needle).length - 1;
}

/**
 * The invariants. Each is a property of the certified artefact that a customer relies on.
 *
 * `certified` is passed so an invariant can be expressed as "the canonical artefact does what the
 * certified one does", rather than as a constant copied out of it — a constant would silently stop
 * describing the certified output the moment that output changed.
 */
const INVARIANTS = Object.freeze([
  {
    key: 'subject_identical',
    // Not "similar". A customer scanning an inbox for a reset recognises the exact line.
    check: ({ certifiedSubject, canonicalSubject }) => canonicalSubject === certifiedSubject,
  },
  {
    key: 'html_document',
    check: ({ canonicalHtml }) => /^<!doctype html>/i.test(canonicalHtml.trim()),
  },
  {
    key: 'mobile_safe_width',
    // 600px is the width every mail client agrees on; losing it is losing mobile legibility.
    check: ({ canonicalHtml, certified }) => canonicalHtml.includes('max-width:600px') === certified.html.includes('max-width:600px'),
  },
  {
    key: 'accessible_action_colour',
    // #C2410C reaches ~5.2:1 on white; the UI's #F97316 is ~2.9:1 and fails WCAG AA. An auth Email
    // is exactly where legibility must not be traded for brand saturation.
    check: ({ canonicalHtml }) => canonicalHtml.includes('#C2410C') && !canonicalHtml.includes('#F97316'),
  },
  {
    key: 'hidden_preheader',
    check: ({ canonicalHtml, certified }) => canonicalHtml.includes(HIDDEN_PREHEADER) === certified.html.includes(HIDDEN_PREHEADER),
  },
  {
    key: 'action_is_clickable',
    // The button. Without it the Email is a paragraph about a reset the reader cannot perform.
    check: ({ canonicalHtml, actionHref }) => occurrences(canonicalHtml, `href="${actionHref}"`) === 1,
  },
  {
    key: 'action_is_also_copyable',
    // The certified layout repeats the URL as visible text, because a client that strips the button
    // or a reader forwarding to another device still needs the link. Two occurrences: anchor + text.
    check: ({ canonicalHtml, actionHref, certified, certifiedHref }) =>
      occurrences(canonicalHtml, actionHref) >= occurrences(certified.html, certifiedHref),
  },
  {
    key: 'action_escaped_exactly_once',
    // G1. `&` becomes `&amp;` once; `&amp;amp;` would break the link the customer pastes.
    check: ({ canonicalHtml }) => !canonicalHtml.includes('&amp;amp;'),
  },
  {
    key: 'action_url_not_mangled',
    // The escaped href must decode back to the URL that was issued — a token altered by one
    // character is a reset that silently fails.
    check: ({ canonicalHtml, actionUrl, actionHref }) =>
      canonicalHtml.includes(actionHref) && actionHref.replace(/&amp;/g, '&') === actionUrl,
  },
  {
    key: 'security_note_present',
    check: ({ canonicalHtml, canonicalText, copy }) =>
      canonicalHtml.includes('used once') && canonicalHtml.includes('expires within the hour')
      && canonicalText.includes(copy.securityNote),
  },
  {
    key: 'no_action_expected_reassurance',
    // The line that stops someone panicking about a reset they did not request.
    check: ({ canonicalHtml }) => /safely ignore this email/i.test(canonicalHtml),
  },
  {
    key: 'reason_received_present',
    check: ({ canonicalHtml, copy }) => canonicalHtml.includes(copy.reasonReceived),
  },
  {
    key: 'plain_text_carries_full_meaning',
    // CarUp's own rule: the canonical message carries the meaning. A text part saying "view this in
    // HTML" has lost the thing that made it a security Email.
    check: ({ canonicalText, actionUrl, copy }) =>
      canonicalText.includes(actionUrl) && canonicalText.includes(copy.heading),
  },
  {
    key: 'no_marketing_control',
    check: ({ canonicalHtml, canonicalText }) =>
      !canonicalHtml.includes('data-carup-unsubscribe') && !/unsubscribe/i.test(canonicalText),
  },
  {
    key: 'no_invented_identity',
    check: ({ canonicalHtml }) =>
      !/\bCEO\b/.test(canonicalHtml) && !/Tendai Moyo/i.test(canonicalHtml)
      && !/facebook|twitter|linkedin|instagram/i.test(canonicalHtml),
  },
  {
    key: 'no_unrouted_or_foreign_link',
    check: ({ canonicalHtml }) =>
      !/vercel\.app/.test(canonicalHtml) && !/carup\.app/.test(canonicalHtml),
  },
]);

export const AUTH_EQUIVALENCE_INVARIANTS = Object.freeze(INVARIANTS.map((i) => i.key));

/**
 * Compare a canonical auth render against the certified one.
 *
 * Returns `{ ok, failures }`. `failures` names every invariant that did not hold, so a caller can
 * log WHICH property broke rather than "equivalence failed" — the difference between a fixable
 * report and a mystery.
 */
export function checkAuthEquivalence({
  certified, certifiedSubject, canonicalHtml, canonicalText, canonicalSubject, actionUrl, copy,
} = {}) {
  if (!certified?.html || !canonicalHtml || !canonicalText || !actionUrl || !copy) {
    return { ok: false, failures: ['inputs_incomplete'] };
  }
  const escape = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const context = {
    certified,
    certifiedSubject,
    canonicalHtml,
    canonicalText,
    canonicalSubject,
    actionUrl,
    actionHref: escape(actionUrl),
    certifiedHref: escape(actionUrl),
    copy,
  };

  const failures = [];
  for (const invariant of INVARIANTS) {
    let held = false;
    try {
      held = Boolean(invariant.check(context));
    } catch {
      held = false;
    }
    if (!held) failures.push(invariant.key);
  }
  return { ok: failures.length === 0, failures };
}

export default checkAuthEquivalence;
