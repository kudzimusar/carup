/**
 * R6 — CarUp Weekly.
 *
 * The editorial marketing reference. Its truth model is HUMAN CURATED, and that is a deliberate
 * position rather than a limitation to apologise for.
 *
 * The repository has no saved searches, no watchlists, no price-drop tracking, no price alerts and
 * no behavioural recommendation wired to Email. So this template says none of those things. "Picked
 * for you" and "based on your searches" are the easiest sentences in marketing to write and among
 * the easiest for a customer to disprove — the first time someone receives a "personalised" list
 * that plainly is not, every other claim CarUp makes about knowing things gets re-read.
 *
 * A well-edited weekly selection, honestly labelled, is a better product than a fake algorithm.
 */
import { EMAIL_BRAND_IDENTITY } from './emailBrandIdentity.js';
import { canonicalEmailLink } from './canonicalEmailLinks.js';
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/** How many highlights one issue may carry. Beyond this it stops being edited and starts being a feed. */
export const MAX_HIGHLIGHTS = 6;

/**
 * A highlight, from a canonical eligible listing.
 *
 * Media is used ONLY when the canonical projection published one for a listing that is publicly
 * visible. There is no stock imagery, no placeholder car and no third-party image host: an Email
 * lives in an inbox for years, and a borrowed image is a broken image with a delay on it.
 */
function highlightBlock(highlight = {}, origin) {
  const listing = highlight.listing_summary && typeof highlight.listing_summary === 'object' ? highlight.listing_summary : {};
  const vin = listing.vin || null;
  const titleParts = [listing.year, listing.make, listing.model].filter((p) => p != null && String(p).trim() !== '');
  const rows = [];
  if (listing.mileage != null && listing.mileage !== '') {
    rows.push({ label: 'Mileage', value: `${Number(listing.mileage).toLocaleString('en-US')} km` });
  }
  if (listing.price != null && listing.price !== '') {
    rows.push({ label: 'Asking price', value: `${listing.currency || ''} ${Number(listing.price).toLocaleString('en-US')}`.trim() });
  }
  if (listing.seller_display_label_state === 'recorded' && listing.seller_display_label) {
    rows.push({ label: 'Seller', value: listing.seller_display_label });
  }
  const usableMedia = listing.primary_image_url && listing.primary_image_state && listing.primary_image_state !== 'none';
  return {
    type: 'card',
    title: titleParts.length ? titleParts.join(' ') : 'A CarUp listing',
    // The editor's note is why this vehicle is in the issue. It is written by a person, and it is
    // the only opinion in the Email.
    subtitle: highlight.editorial_note || null,
    rows,
    imageUrl: usableMedia ? listing.primary_image_url : null,
    imageAlt: usableMedia ? titleParts.join(' ') : '',
    // A descriptive link, not a naked URL. With images disabled the card still reads as a complete
    // entry with somewhere to go, which is the whole point of the no-media form being a supported
    // design rather than a degraded one.
    link: vin ? { label: 'View vehicle record', url: `${origin}/marketplace/listing/${encodeURIComponent(vin)}` } : null,
    accent: true,
    footnote: null,
  };
}

/**
 * Build the R6 document, or null when there is nothing to send.
 *
 * An issue with no editorial introduction and no highlights is not a thin issue — it is not an
 * issue. Refusing is better than mailing a masthead and a footer to everyone who opted in.
 */
export function buildCarUpWeeklyDocument({ payload = {}, classification, env = process.env } = {}) {
  const origin = resolveCanonicalWebOrigin(env).replace(/\/+$/, '');
  const issue = payload.weekly_issue && typeof payload.weekly_issue === 'object' ? payload.weekly_issue : {};
  const highlights = (Array.isArray(issue.highlights) ? issue.highlights : []).slice(0, MAX_HIGHLIGHTS);
  const intro = String(issue.editorial_intro || '').trim();
  if (!intro && !highlights.length) return null;

  const blocks = [];
  if (highlights.length) {
    blocks.push({ type: 'sectionHeading', text: 'This week on CarUp' });
    for (const highlight of highlights) blocks.push(highlightBlock(highlight, origin));
    blocks.push({ type: 'action', label: 'Browse the Marketplace', url: `${origin}/marketplace` });
  }

  // Education, only where it is true of the product. This is CarUp describing how it works, not a
  // claim about a specific vehicle.
  if (issue.education_note) {
    blocks.push({ type: 'sectionHeading', text: 'Knowing what you are buying' });
    blocks.push({ type: 'paragraph', text: String(issue.education_note) });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'paragraph',
    text: `${EMAIL_BRAND_IDENTITY.consumerTagline} Every vehicle on CarUp carries a record of what is actually known about it — and what is not.`,
  });

  return {
    classification,
    preheaderText: intro ? intro.slice(0, 140) : 'This week on CarUp.',
    heading: issue.title || 'CarUp Weekly',
    // The masthead standfirst — the editorial voice, above the fold.
    standfirst: 'Edited by people at CarUp. A selection, not an algorithm.',
    // Human curated, and it says so. Not a disclaimer — a description of what this actually is.
    // Phrased as a positive statement of what this IS. A denial ("not based on your searches")
    // would put the very claim it disowns in front of the reader, and a customer skimming an Email
    // remembers the noun, not the negation.
    bodyText: intro,
    blocks,
    action: null,
    note: null,
    // The G3 block carries its own reason-received line, so the footer does not repeat it.
    reasonReceived: null,
    unsubscribeUrl: payload.unsubscribe_url || null,
    supportUrl: canonicalEmailLink('support', env),
  };
}

export default buildCarUpWeeklyDocument;
