/**
 * How a recipient's name is presented in an Email.
 *
 * One resolver, because the alternative already shipped once: a template interpolating a raw stored
 * name produced `Welcome MUSARURWA SHADRECK` — the customer's own name, shouted back at them in the
 * casing a form happened to store it in. Plan §7.1 forbids that, and forbidding it in prose is not
 * the same as having one function that cannot do it.
 *
 * Two rules:
 *
 *   - render TITLE CASE, never the stored casing;
 *   - when no usable name exists, return null so the caller renders a graceful non-personalised
 *     greeting. A fabricated first name is worse than no name at all.
 */

/** Words that are stored as names but are not one. */
const NOT_A_NAME = new Set(['null', 'undefined', 'n/a', 'na', 'unknown', 'user', 'test', 'admin', '-']);

function titleCaseWord(word) {
  // `O'Brien`, `McDonald` and `Jean-Paul` are all names people actually have.
  return word
    .split(/([-'’])/)
    .map((part) => (/^[-'’]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * The greeting name, or null.
 *
 * Takes the FIRST word only: an Email that opens "Hi Musarurwa Shadreck," reads like a form letter,
 * and the greeting is the one place a full legal name is wrong.
 */
export function greetingName(name) {
  const raw = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (NOT_A_NAME.has(raw.toLowerCase())) return null;
  // An address is not a name, and rendering the local part of one is a privacy leak dressed as
  // personalisation.
  if (raw.includes('@')) return null;
  const first = raw.split(' ')[0];
  if (first.length < 2) return null;
  if (!/[a-z]/i.test(first)) return null;
  return titleCaseWord(first);
}

/** `Hi Tendai,` or `Hi there,` — never `Hi ,` and never a fabricated name. */
export function greeting(name) {
  const resolved = greetingName(name);
  return resolved ? `Hi ${resolved},` : 'Hi there,';
}

export default greetingName;
