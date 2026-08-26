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

/**
 * A block, as plain text.
 *
 * Not a stripped-down rendering of the HTML — the same declaration, said in the medium plain text
 * actually has. A card becomes labelled lines; a status list becomes labelled lines; a quote is
 * marked as quoted. Literal characters throughout, per G1.
 */
function blockToText(block) {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'paragraph':
    case 'panel':
      return String(block.text || '').trim() || null;
    case 'sectionHeading': {
      const text = String(block.text || '').trim();
      return text ? `${text}\n${'-'.repeat(Math.min(text.length, 40))}` : null;
    }
    case 'quote': {
      const body = String(block.text || '').trim();
      if (!body) return null;
      const quoted = body.split('\n').map((line) => `> ${line}`).join('\n');
      return block.attribution ? `${quoted}\n> — ${block.attribution}` : quoted;
    }
    case 'card': {
      const lines = [String(block.title || '').trim()].filter(Boolean);
      if (block.subtitle) lines.push(String(block.subtitle));
      for (const row of block.rows || []) {
        if (!row?.label) continue;
        lines.push(`${row.label}: ${row.value == null || row.value === '' ? 'Not recorded' : row.value}`);
      }
      if (block.footnote) lines.push(String(block.footnote));
      return lines.length ? lines.join('\n') : null;
    }
    case 'statusList': {
      const lines = (block.items || [])
        .filter((item) => item?.label)
        .map((item) => (item.detail ? `${item.label}\n  ${item.detail}` : String(item.label)));
      return lines.length ? lines.join('\n') : null;
    }
    case 'signature':
      return [block.name, block.title, block.organisation].filter(Boolean).join('\n') || null;
    case 'action':
      return block.label && block.url ? `${block.label}:\n${block.url}` : null;
    case 'divider':
      return '—';
    default:
      return null;
  }
}

export function renderEmailText(document = {}, { env = process.env } = {}) {
  const {
    classification, heading = null, bodyText = '', action = null, note = null,
    reasonReceived = null, unsubscribeUrl = null, blocks: documentBlocks = [],
  } = document;

  const blocks = [];
  if (heading) blocks.push(heading);
  const body = String(bodyText || '').trim();
  if (body) blocks.push(body);
  for (const block of Array.isArray(documentBlocks) ? documentBlocks : []) {
    const text = blockToText(block);
    if (text) blocks.push(text);
  }
  // The URL is written out in full. A text part has no anchor to hide it behind, and a reader may
  // have to copy it by hand.
  if (action?.label && action?.url) blocks.push(`${action.label}:\n${action.url}`);
  if (note) blocks.push(note);
  blocks.push(renderFooterText({ classification, reasonReceived, unsubscribeUrl, env }));

  return blocks.filter(Boolean).join('\n\n');
}

export default renderEmailText;
