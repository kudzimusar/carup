/**
 * Canonical CarUp Email brand tokens.
 *
 * These are the values `authEmailTemplates.js` already ships and that were physically certified in
 * a real inbox during SA1/E7 — lifted here so one table serves every family, not re-picked.
 * `authEmailTemplates.BRAND` re-exports this, so the certified auth output is byte-identical.
 *
 * ACTION is a deepened CarUp orange rather than the UI's #F97316: white on #F97316 is ~2.9:1 and
 * fails WCAG AA, while #C2410C reaches ~5.2:1 and still reads as CarUp orange. Email is exactly
 * where legibility must not be traded for brand saturation.
 */
export const EMAIL_BRAND_TOKENS = Object.freeze({
  INK: '#0F172A',
  BODY: '#334155',
  MUTED: '#64748B',
  ACTION: '#C2410C',
  ACTION_TEXT: '#FFFFFF',
  SURFACE: '#FFFFFF',
  CANVAS: '#F1F5F9',
  BORDER: '#E2E8F0',
  MAX_WIDTH: 600,
});

/** The one font stack, so a family cannot drift into a different typographic identity. */
export const EMAIL_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export default EMAIL_BRAND_TOKENS;
