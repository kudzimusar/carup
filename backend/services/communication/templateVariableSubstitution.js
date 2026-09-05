/**
 * The single escaping authority for CarUp template variable substitution.
 *
 * Both template paths — the governed registry and the pre-registry fallback — substitute variables
 * through here so there is exactly one place that decides what a rendered value looks like.
 *
 * Ownership, by representation:
 *
 *   plain text / subject   preserve the literal semantic characters the author wrote
 *   HTML                   escape ONCE, at the HTML rendering boundary
 *   URL                    encode per URL semantics, where the URL is built
 *   provider JSON          JSON serialization only; never pre-escaped for HTML
 *
 * Both services previously HTML-escaped values while building the canonical plain text. That is the
 * wrong layer twice over: a customer reading text/plain saw `Automotive Intelligence &amp; Trust
 * Network`, and a correct HTML producer escaping the same string again would show them
 * `&amp;amp;`. Escaping belongs to the representation, not to substitution — substitution does not
 * know whether its output will end up in a subject header, a text part, or an HTML document.
 *
 * The HTML boundary that does own escaping is `escapeHtmlText` in `adapters/providerAdapters.js`.
 * It must keep escaping; this module must not.
 */

const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Substitute `{{name}}` placeholders with their literal values.
 *
 * Uses a replacer function rather than a replacement string, so `$&`/`$1` inside a value are not
 * re-interpreted, and so a substituted value is never itself rescanned for placeholders.
 */
export function substituteVariables(text, variables = {}) {
  return String(text || '').replace(VARIABLE_PATTERN, (_match, key) => String(variables[key] ?? ''));
}
