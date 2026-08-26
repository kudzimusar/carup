/**
 * First-class plain text, from the same document the HTML shell renders.
 *
 * Not a stripped-down HTML fallback. A plain-text part is what a screen reader, a text-only client,
 * a forwarded quote and an inbox preview all read, and CarUp's own rule is that the canonical
 * message carries the FULL meaning — a security Email whose text part says "view this in HTML" has
 * lost the thing that made it a security Email.
 *
 * Literal characters throughout, per G1: this is not an HTML document, and an `&amp;` here is a
 * defect a customer reads.
 */
import { renderFooterText } from './emailFooters.js';

export function renderEmailText(document = {}, { env = process.env } = {}) {
  const {
    classification, heading = null, bodyText = '', action = null, note = null,
    reasonReceived = null, unsubscribeUrl = null,
  } = document;

  const blocks = [];
  if (heading) blocks.push(heading);
  const body = String(bodyText || '').trim();
  if (body) blocks.push(body);
  // The URL is written out in full. A text part has no anchor to hide it behind, and a reader may
  // have to copy it by hand.
  if (action?.label && action?.url) blocks.push(`${action.label}:\n${action.url}`);
  if (note) blocks.push(note);
  blocks.push(renderFooterText({ classification, reasonReceived, unsubscribeUrl, env }));

  return blocks.filter(Boolean).join('\n\n');
}

export default renderEmailText;
