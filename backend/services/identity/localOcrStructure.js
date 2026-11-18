// ICAO Doc 9303 Parts 3 and 4. The checks apply to an observed TD3 text
// pattern only. They do not establish document class, country or authenticity.
function digitMatches(value, printed) {
  const weights = [7, 3, 1];
  const sum = Array.from(value).reduce((total, character, index) => {
    const code = character.charCodeAt(0);
    const numeric = character === '<' ? 0 : code >= 65 ? code - 55 : code - 48;
    return total + numeric * weights[index % 3];
  }, 0);
  return String(sum % 10) === printed;
}

export function observedTd3Rows(text) {
  // The OCR engine may insert horizontal spacing between printed glyphs.
  // Preserve line boundaries and every non-spacing character as read.
  const lines = text.split(/\r?\n/u).map(line => line.trim().replace(/[ \t]/gu, ''));
  const upperIndex = lines.findIndex(line => /^P[A-Z<][A-Z]{3}[A-Z<]{15,}/u.test(line));
  return upperIndex < 0 ? null : [lines[upperIndex], lines.slice(upperIndex + 1).find(Boolean) || ''];
}

export function inspectTd3Structure(text) {
  const rows = observedTd3Rows(text);
  if (!rows) return 'not_observed';
  const [upper, lower] = rows;
  if (!/^P[A-Z<][A-Z]{3}[A-Z][A-Z<]{38}$/u.test(upper)
    || !/^[A-Z0-9<]{9}\d[A-Z<]{3}\d{7}[MF<]\d{7}[A-Z0-9<]{14}[\d<]\d$/u.test(lower)) {
    return 'unreadable';
  }
  const optional = lower.slice(28, 42);
  const composite = lower.slice(0, 10) + lower.slice(13, 20) + lower.slice(21, 43);
  return digitMatches(lower.slice(0, 9), lower[9]) && digitMatches(lower.slice(13, 19), lower[19])
    && digitMatches(lower.slice(21, 27), lower[27])
    && (optional === '<'.repeat(14) && lower[42] === '<' || digitMatches(optional, lower[42]))
    && digitMatches(composite, lower[43]) ? 'checksums_pass' : 'checksums_fail';
}
