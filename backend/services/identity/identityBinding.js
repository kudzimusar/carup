/**
 * Phase 7C Workstream F — account-holder vs document-holder binding.
 *
 * The authenticated ACCOUNT holder and the person named on the uploaded
 * DOCUMENT are separate facts. A material mismatch must never auto-verify; it
 * routes to manual review with a stored reason. Account profile data is never
 * overwritten from OCR. (This module is pure comparison logic; callers persist
 * the result and surface both identities to the reviewer.)
 */

/** Normalize a name for comparison: lowercase, strip diacritics + punctuation,
 *  collapse whitespace. */
export function normalizeName(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(normalized) {
  return new Set(normalized.split(' ').filter(Boolean));
}

/**
 * Compare the account holder name to the document holder name.
 * Returns { status: 'match' | 'mismatch' | 'indeterminate', reason, normalizedAccount, normalizedDocument }.
 * - indeterminate when either side is unknown (cannot assert a mismatch).
 * - match on exact normalized equality, equal token sets, or (surname + first
 *   initial) agreement.
 * - mismatch otherwise (material — must not auto-verify).
 */
export function compareAccountToDocument({ accountName, documentName } = {}) {
  const normalizedAccount = normalizeName(accountName);
  const normalizedDocument = normalizeName(documentName);

  if (!normalizedAccount || !normalizedDocument) {
    return {
      status: 'indeterminate',
      reason: 'Account or document name unavailable; identity binding could not be evaluated.',
      normalizedAccount,
      normalizedDocument,
    };
  }

  if (normalizedAccount === normalizedDocument) {
    return { status: 'match', reason: null, normalizedAccount, normalizedDocument };
  }

  const a = tokenSet(normalizedAccount);
  const d = tokenSet(normalizedDocument);
  const sameTokens = a.size === d.size && [...a].every((t) => d.has(t));
  if (sameTokens) {
    return { status: 'match', reason: null, normalizedAccount, normalizedDocument };
  }

  // Surname + first-initial agreement (handles middle names / ordering).
  const at = normalizedAccount.split(' ').filter(Boolean);
  const dt = normalizedDocument.split(' ').filter(Boolean);
  const surnameMatch = at[at.length - 1] === dt[dt.length - 1];
  const firstInitialMatch = at[0] && dt[0] && at[0][0] === dt[0][0];
  if (surnameMatch && firstInitialMatch) {
    return { status: 'match', reason: null, normalizedAccount, normalizedDocument };
  }

  return {
    status: 'mismatch',
    reason: `Account holder ("${accountName}") does not match the document holder ("${documentName}").`,
    normalizedAccount,
    normalizedDocument,
  };
}

/** Build the display "document holder" name from OCR fields. */
export function documentHolderName(ocr = {}) {
  const parts = [ocr.first_name, ocr.last_name].filter((p) => typeof p === 'string' && p.trim());
  return parts.join(' ').trim();
}
