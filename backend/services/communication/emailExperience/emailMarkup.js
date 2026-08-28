/**
 * The shared HTML boundary for CarUp Email.
 *
 * G1 established the rule; G2 gives it one home. Escaping belongs to the REPRESENTATION, and it
 * happens exactly once, where that representation is built:
 *
 *   plain text        literal characters, always
 *   HTML text node    escaped once, here
 *   HTML attribute    escaped once, here
 *   URL               encoded as a URL first, then attribute-escaped only on insertion into HTML
 *   provider JSON     serialization only; never pre-escaped for HTML
 *
 * Markup a caller wants preserved must say so explicitly through `safeHtml()`. Everything else is
 * treated as text, so the default for an unmarked value is safe rather than trusting.
 */

/** Escape a value for an HTML TEXT node. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Escape a value for an HTML ATTRIBUTE.
 *
 * Identical to the text-node escaper today. Kept as a distinct name because the two are different
 * contexts with different rules, and a future attribute-specific requirement must not force a
 * choice between changing text escaping too or forking a second escaper.
 */
export function escapeAttr(value) {
  return escapeHtml(value);
}

const TRUSTED = Symbol('carup.trustedHtml');

/**
 * Mark a string as already-safe markup this module built.
 *
 * The only way to get raw markup past `html()`. It is a deliberate, greppable act: `safeHtml(x)` in
 * a diff is a claim that x is markup the author controls, and reviewing that claim is the whole
 * point of making it explicit.
 */
export function safeHtml(markup) {
  return { [TRUSTED]: true, value: String(markup == null ? '' : markup) };
}

export function isSafeHtml(value) {
  return Boolean(value && typeof value === 'object' && value[TRUSTED] === true);
}

/** Render one interpolated value: trusted markup passes through, everything else is escaped. */
function renderValue(value) {
  if (isSafeHtml(value)) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value == null || value === false) return '';
  return escapeHtml(value);
}

/**
 * Tagged template for HTML. Interpolated values are escaped unless wrapped in `safeHtml`.
 *
 * Returns trusted markup, so composing components nests without re-escaping — which is precisely
 * the double-escaping G1 removed.
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) out += renderValue(values[i]);
  });
  return safeHtml(out);
}

/** Unwrap trusted markup to a string, escaping anything that is not. */
export function renderHtml(value) {
  return renderValue(value);
}

/** Join a list of trusted fragments, dropping the empty ones. */
export function joinHtml(parts, separator = '') {
  return safeHtml(parts.filter(Boolean).map(renderValue).join(separator));
}
