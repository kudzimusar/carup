/**
 * R3 — Marketplace conversation.
 *
 * A message one human wrote, delivered to another, about a specific vehicle. It carries the G5
 * authenticated Reply-To, so replying to it lands back in the same canonical conversation with the
 * same participant.
 *
 * TRUTH SOURCES, and nothing else. The vehicle context comes from the audience-safe marketplace
 * listing summary — the same projection the public API serves. This module never reads
 * `vehicles.trust_score` (an unversioned legacy column that once published `84` beside a report
 * saying `not_evaluated`), never reads private evidence, never reads owner or seller identity, and
 * never resolves a contact channel to an address. If a fact is not on the public projection, it is
 * not in the Email.
 */
import { escapeHtml } from './emailMarkup.js';
import { canonicalEmailLink } from './canonicalEmailLinks.js';
import { greeting } from './recipientPresentation.js';
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/**
 * The excerpt budget.
 *
 * A conversation excerpt is the most user-controlled text in the system: written by one customer,
 * rendered into an Email read by another. It is bounded so a very long message cannot push the
 * action below a phone screen, and escaped by the shared boundary like every other value — an
 * excerpt is text, never markup.
 */
export const MESSAGE_EXCERPT_LIMIT = 320;

export function messageExcerpt(text, limit = MESSAGE_EXCERPT_LIMIT) {
  const normalised = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalised) return null;
  if (normalised.length <= limit) return normalised;
  // Cut on a word boundary so the excerpt does not end mid-word.
  const cut = normalised.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** `2018 Toyota Aqua`, from public identity fields only, degrading as facts run out. */
export function vehicleTitle(listing = {}) {
  const parts = [listing.year, listing.make, listing.model].filter((part) => part != null && String(part).trim() !== '');
  return parts.length ? parts.join(' ') : 'A CarUp listing';
}

/** Public listing rows. A missing fact renders as a stated gap, never as a guess. */
function listingRows(listing = {}) {
  const rows = [];
  if (listing.mileage != null && listing.mileage !== '') {
    rows.push({ label: 'Mileage', value: `${Number(listing.mileage).toLocaleString('en-US')} km` });
  } else {
    rows.push({ label: 'Mileage', value: null });
  }
  if (listing.price != null && listing.price !== '') {
    rows.push({ label: 'Asking price', value: `${listing.currency || ''} ${Number(listing.price).toLocaleString('en-US')}`.trim() });
  }
  // The SELLER is published as a label, never as an identity. `seller_display_label_state` is the
  // canonical statement of whether one may be shown at all.
  if (listing.seller_display_label_state === 'recorded' && listing.seller_display_label) {
    rows.push({ label: 'Seller', value: listing.seller_display_label });
  }
  return rows;
}

/**
 * Build the R3 document.
 *
 * `listing` is expected to be a `buildMarketplaceListingSummary` result (or null). Passing a raw
 * vehicle row would put private columns one property access away from an Email, which is exactly
 * why the public projection exists.
 */
export function buildMarketplaceConversationDocument({ payload = {}, classification, env = process.env } = {}) {
  const origin = resolveCanonicalWebOrigin(env).replace(/\/+$/, '');
  const listing = payload.listing_summary && typeof payload.listing_summary === 'object' ? payload.listing_summary : null;
  const vin = listing?.vin || payload.vin || null;
  const excerpt = messageExcerpt(payload.message_excerpt);
  const senderLabel = payload.sender_display_label || 'Someone on CarUp';
  const title = vehicleTitle(listing || {});

  // The ONLY real conversation destination in the application. There is no thread deep-link route,
  // so the Email links the conversations surface rather than inventing a path that would answer 200
  // with the SPA shell and land the customer nowhere. Recorded as a limitation, not papered over.
  const conversationsUrl = `${origin}/dashboard/communications`;
  // The listing route IS specific, and takes the VIN.
  const listingUrl = vin ? `${origin}/marketplace/listing/${encodeURIComponent(vin)}` : null;

  const blocks = [
    excerpt
      ? { type: 'quote', text: excerpt, attribution: senderLabel }
      : { type: 'paragraph', text: `${senderLabel} sent you a message on CarUp.` },
    {
      type: 'card',
      title,
      subtitle: vin ? `VIN ${vin}` : null,
      rows: listingRows(listing || {}),
      // Media only when the canonical projection published one. `primary_image_state` says whether
      // an image may be shown at all; a listing with none renders an excellent card without one
      // rather than a fabricated photograph.
      imageUrl: listing?.primary_image_url && listing?.primary_image_state !== 'none' ? listing.primary_image_url : null,
      imageAlt: listing?.primary_image_url ? title : '',
      footnote: listingUrl ? `View the full record: ${listingUrl}` : null,
    },
    { type: 'action', label: 'Open your CarUp conversations', url: conversationsUrl },
    {
      type: 'panel',
      text: 'Keep the conversation on CarUp. Anything agreed here stays attached to the vehicle it was about. CarUp will never ask you to move a deal to another platform or to pay someone directly outside a CarUp flow you started yourself.',
    },
  ];

  return {
    classification,
    preheaderText: excerpt || `${senderLabel} sent you a message about ${title}.`,
    heading: 'You have a new message',
    bodyText: [greeting(payload.recipient_name), '', `${senderLabel} sent you a message about ${title} on CarUp.`].join('\n'),
    blocks,
    action: null,
    note: null,
    reasonReceived: 'You are receiving this because you are part of this conversation on CarUp.',
    unsubscribeUrl: null,
    // NO reply address is declared here. G5 mints the authenticated conversation Reply-To at the
    // delivery worker, bound to the exact participant — declaring a second one would give the
    // customer two ways to reply, only one of which routes.
    conversationDestinationLimited: true,
  };
}

export { escapeHtml };
export default buildMarketplaceConversationDocument;
