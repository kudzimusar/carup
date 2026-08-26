/**
 * G3 — the PRESENTATION authority for the marketing unsubscribe control.
 *
 * Three authorities own the unsubscribe story after G3, and none of them may do another's job:
 *
 *   CANONICAL CONSENT      `marketingConsentState.js` over `communication_suppressions` —
 *                          decides WHETHER a marketing message may be sent.
 *   PRESENTATION (here)    decides what the customer SEES and reads, in both representations.
 *   TRANSPORT COMPLIANCE   the Brevo adapter — owns `List-Unsubscribe` / `List-Unsubscribe-Post`
 *                          and fail-closed validation, and nothing visible.
 *
 * Before G3 the Brevo adapter authored the visible footer itself, inside the same function that
 * called the provider. That put customer-facing copy in a transport component, made the control
 * impossible to render or review anywhere else, and meant no other layer could be held responsible
 * for it. It also made "exactly one unsubscribe control" unverifiable: the component that would
 * have to detect a duplicate was the component adding one.
 *
 * This module is deliberately NOT a renderer. It owns one control. G2's canonical renderer consumes
 * it: `emailFooters.js` composes the marketing family footer around this block, so the block a
 * customer clicks is the same block the Brevo adapter validates.
 *
 * It MUST NOT query providers, decide suppression state, send anything, or grow into a second
 * general-purpose renderer.
 */

/**
 * The CarUp-owned structural marker.
 *
 * Counting the word "unsubscribe" cannot distinguish the canonical control from editorial copy that
 * happens to mention unsubscribing — and a marketing email about managing your preferences would be
 * exactly that. This attribute is emitted only by this module, is invisible to the reader, and is
 * inert in every mail client, so counting it is deterministic.
 */
export const UNSUBSCRIBE_MARKER_ATTRIBUTE = 'data-carup-unsubscribe';
export const UNSUBSCRIBE_PRESENTATION_VERSION = 'v1';
const MARKER = `${UNSUBSCRIBE_MARKER_ATTRIBUTE}="${UNSUBSCRIBE_PRESENTATION_VERSION}"`;

/** Why a marketing payload was refused. Distinct codes so a receipt can say which rule failed. */
export const UNSUBSCRIBE_PRESENTATION_ERRORS = Object.freeze({
  MISSING_URL: 'unsubscribe_action_missing',
  MISSING: 'unsubscribe_presentation_missing',
  NOT_PERMITTED: 'unsubscribe_presentation_not_permitted',
  DUPLICATED: 'unsubscribe_presentation_duplicated',
  INCONSISTENT: 'unsubscribe_presentation_inconsistent',
});

/**
 * Canonical copy, preserved verbatim from the E7 physical certification.
 *
 * A human read this wording in a real inbox and accepted it; it is not re-authored here. The
 * essential/marketing distinction is load-bearing rather than reassurance — a reader who unsubscribes
 * must know that security and transaction email is a separate thing they are not switching off.
 */
export const UNSUBSCRIBE_COPY = Object.freeze({
  reasonReceived: 'You are receiving this because you opted in to CarUp marketing email.',
  action: 'Unsubscribe from CarUp marketing email',
  textPrompt: "Don't want CarUp marketing email? Unsubscribe here:",
  essentialNotice: 'You will still receive essential account, security and transaction email.',
});

/**
 * Escape text for HTML. The single escaping boundary for this module, per G1: plain text keeps its
 * literal characters and HTML escapes exactly once, here, where the HTML is built.
 *
 * G2 moves this into `emailMarkup.js` as the shared boundary; until then this is the only escaper
 * the marketing path uses, and the Brevo adapter imports `unsubscribeHrefFor` rather than keeping a
 * duplicate of its own.
 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The unsubscribe URL as an HTML attribute value.
 *
 * Exported because the transport layer must look for the href AS THE HTML CARRIES IT. The URL is a
 * single identity with two representations: `?a=1&b=2` in a header or a text part, `?a=1&amp;b=2`
 * inside an attribute. Comparing one against the other is how a compliance receipt ends up reporting
 * a missing control that is in fact present.
 */
export function unsubscribeHrefFor(unsubscribeUrl) {
  return escapeHtml(unsubscribeUrl);
}

/** Count non-overlapping occurrences of a literal needle. No regex — the URL is not a pattern. */
function occurrences(haystack, needle) {
  if (!needle) return 0;
  return String(haystack || '').split(needle).length - 1;
}

/**
 * The canonical HTML unsubscribe block: reason received, one action, essential-mail distinction.
 */
export function unsubscribeHtmlBlock(unsubscribeUrl) {
  const href = unsubscribeHrefFor(unsubscribeUrl);
  return `<div ${MARKER} style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#475569;">`
    + `<p style="margin:0 0 8px;">${UNSUBSCRIBE_COPY.reasonReceived}</p>`
    + `<p style="margin:0;"><a href="${href}" style="color:#C2410C;font-weight:600;text-decoration:underline;">${UNSUBSCRIBE_COPY.action}</a></p>`
    + `<p style="margin:8px 0 0;color:#64748b;">${UNSUBSCRIBE_COPY.essentialNotice}</p>`
    + `</div>`;
}

/**
 * The canonical plain-text unsubscribe section — the same meaning and the same URL.
 *
 * The URL is written literally. A text part is not an HTML document, so escaping it here would put
 * `&amp;` in front of a reader and break the link they may have to copy by hand.
 */
export function unsubscribeTextBlock(unsubscribeUrl) {
  return `—\n${UNSUBSCRIBE_COPY.textPrompt}\n${unsubscribeUrl}\n\n${UNSUBSCRIBE_COPY.essentialNotice}`;
}

/*
 * RETIRED IN G2 — `wrapPlainTextAsHtml` and `applyMarketingUnsubscribePresentation`.
 *
 * They existed only because no renderer did: a marketing send needed somewhere to put a clickable
 * control while `renderEmail.js` was still a plan. The canonical Email shell now renders the
 * marketing family and composes this module's block through `emailFooters.js`, so the interim
 * carrier would be a second, divergent way to produce marketing HTML. This module kept what it
 * genuinely owns — the block, its marker, and the contract that validates it.
 */

/**
 * Validate finished marketing content against the exactly-one contract.
 *
 * This is defence in depth and is deliberately independent of `applyMarketingUnsubscribePresentation`:
 * it counts what is actually in the payload rather than trusting a declaration, so it refuses
 * malformed marketing email no matter which layer produced it — including a future renderer, a
 * hand-built payload, or a caller that bypassed the composer entirely.
 *
 * `headerUrl` is the transport target. Visible href, text URL and header target are ONE identity in
 * two representations; validating them together is what makes a customer's click and a mail client's
 * one-click POST land in the same place.
 */
export function validateMarketingUnsubscribePresentation({
  html = null, text = '', unsubscribeUrl = null, headerUrl = null, provenance = null,
} = {}) {
  if (!unsubscribeUrl) {
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.MISSING_URL,
      errorMessage: 'Marketing Email requires a governed CarUp unsubscribe URL; refusing to send without one.',
    };
  }

  const htmlText = typeof html === 'string' ? html : '';
  const plainText = typeof text === 'string' ? text : '';
  const href = unsubscribeHrefFor(unsubscribeUrl);

  const markers = occurrences(htmlText, MARKER);
  const anchors = occurrences(htmlText, `href="${href}"`);
  const textLinks = occurrences(plainText, unsubscribeUrl);

  const counts = { markers, anchors, text_links: textLinks };

  if (markers === 0 || textLinks === 0) {
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.MISSING,
      errorMessage: `Marketing Email must carry exactly one canonical unsubscribe presentation in BOTH parts (markers=${markers}, text_links=${textLinks}).`,
      counts,
    };
  }
  if (markers > 1 || anchors > 1 || textLinks > 1) {
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.DUPLICATED,
      errorMessage: `Marketing Email must carry exactly ONE unsubscribe control; found markers=${markers}, anchors=${anchors}, text_links=${textLinks}.`,
      counts,
    };
  }
  if (anchors !== 1) {
    // A marker with no matching href means the visible action points somewhere other than the
    // canonical URL — a control that looks right and unsubscribes nobody.
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.INCONSISTENT,
      errorMessage: 'The canonical unsubscribe block does not link to the canonical unsubscribe URL.',
      counts,
    };
  }
  if (headerUrl != null && String(headerUrl) !== String(unsubscribeUrl)) {
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.INCONSISTENT,
      errorMessage: 'The visible unsubscribe URL and the List-Unsubscribe transport target must be the same URL.',
      counts,
    };
  }
  if (provenance && String(provenance.url || '') !== String(unsubscribeUrl)) {
    return {
      ok: false,
      errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.INCONSISTENT,
      errorMessage: 'Declared unsubscribe provenance does not match the URL actually presented.',
      counts,
    };
  }

  return { ok: true, counts, href };
}

/**
 * The same contract read in the other direction: NON-marketing email must not carry this control.
 *
 * The exactly-one rule was one-directional without this. Transport refused marketing content that
 * LACKED a control, and nothing anywhere refused a security, auth, conversational, transactional or
 * service Email that CARRIED one. Today that is unreachable — only the marketing composer emits the
 * marker — but G2 introduces `emailFooters.js`, one module switching between three footer families,
 * and a wrong branch there would ship a security Email inviting the reader to unsubscribe from mail
 * they cannot unsubscribe from. Worse, a client honouring `List-Unsubscribe` one-click could act on
 * it. The guard is cheap now and unwritable later.
 *
 * Keyed on the marker, never on the word: a transactional Email may legitimately talk about
 * unsubscribing, and a support thread about it must still be deliverable.
 */
export function assertNoMarketingUnsubscribePresentation({ html = null, text = null } = {}) {
  const markers = occurrences(typeof html === 'string' ? html : '', MARKER);
  if (markers === 0) return { ok: true };
  return {
    ok: false,
    errorCode: UNSUBSCRIBE_PRESENTATION_ERRORS.NOT_PERMITTED,
    errorMessage: 'A non-marketing Email must not carry the canonical marketing unsubscribe control.',
    counts: { markers },
  };
}

export default validateMarketingUnsubscribePresentation;
