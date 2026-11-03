/**
 * The O2-X4 fingerprint guard's one schema exception (PAY-05-R1; Moderator directive on issue #255).
 *
 * A word-level exclusion cannot tell a permitted credential digest from a prohibited column of the same name in the same file,
 * so the exception is tied to one schema node: this table, this exact column declaration, this file. Every column declared
 * with "fingerprint" in its name anywhere else — the same name, a wider type, an ALTER, a table built from a query — is a
 * violation. Only the reviewed files below may then refer to that one approved column.
 *
 * This guards biometric storage. It does not describe biometric architecture, which it leaves alone.
 */
export const APPROVED_KEY_DIGEST = Object.freeze({
  file: '20261103100000_carup_pay05_zimbabwe_paynow_collections.sql',
  table: 'public.pay05_merchant_integrations',
  declaration: "credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$')",
});
/** Files reviewed as only READING or copying that one column. A new file must be added here deliberately. */
export const KEY_DIGEST_REFERENCE_FILES = Object.freeze(new Set([
  APPROVED_KEY_DIGEST.file,
  '20261104100000_carup_pay05_r1_financial_integrity.sql',
]));

export const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/** The offset of the parenthesis closing the one at `open`, ignoring parentheses inside string literals. */
function closingParen(sql, open) {
  let depth = 0;
  let inString = false;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") inString = false;
    } else if (ch === "'") inString = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level comma-separated elements of a table body. */
function tableElements(body) {
  const out = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (const ch of body) {
    if (inString) {
      if (ch === "'") inString = false;
    } else if (ch === "'") inString = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0 && !inString) { out.push(current); current = ''; } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

const TABLE_CONSTRAINT = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;

/**
 * Every place a schema gets something named *fingerprint*: { table, kind, text }. Scans the whole text, so a declaration inside
 * a function body or a DO block counts too.
 */
export function fingerprintDeclarations(rawSql) {
  const sql = stripSqlComments(rawSql);
  const found = [];
  for (const m of sql.matchAll(/create\s+(?:(?:global|local|temporary|temp|unlogged)\s+)*table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?(?:\."?\w+"?)?)\s*(\(|as\b)/gi)) {
    const table = m[1].replace(/"/g, '');
    if (m[2].toLowerCase() === 'as') {
      const end = sql.indexOf(';', m.index);
      const text = sql.slice(m.index, end < 0 ? undefined : end);
      if (/fingerprint/i.test(text)) found.push({ table, kind: 'table_from_query', text: normalize(text) });
      continue;
    }
    const open = m.index + m[0].length - 1;
    const close = closingParen(sql, open);
    if (close < 0) { found.push({ table, kind: 'unparsed_table', text: normalize(sql.slice(m.index, m.index + 200)) }); continue; }
    for (const element of tableElements(sql.slice(open + 1, close))) {
      const text = normalize(element);
      if (TABLE_CONSTRAINT.test(text)) continue;
      const name = /^"?([\w$]+)"?/.exec(text)?.[1] ?? '';
      if (/fingerprint/i.test(name)) found.push({ table, kind: 'column', text });
    }
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("?[\w.]+"?(?:\."?\w+"?)?)([^;]*);/gi)) {
    const table = m[1].replace(/"/g, '');
    for (const add of m[2].matchAll(/add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([\w$]*fingerprint[\w$]*)"?[^,;]*/gi)) {
      found.push({ table, kind: 'added_column', text: normalize(add[0]) });
    }
    for (const rename of m[2].matchAll(/rename\s+(?:column\s+)?"?[\w$]+"?\s+to\s+"?([\w$]*fingerprint[\w$]*)"?/gi)) {
      found.push({ table, kind: 'renamed_column', text: normalize(rename[0]) });
    }
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+)?(?:materialized\s+)?view\s+[^;]*?;/gi)) {
    if (/fingerprint/i.test(m[0])) found.push({ table: null, kind: 'view', text: normalize(m[0]).slice(0, 200) });
  }
  return found;
}

const isApproved = (decl, fileName) => fileName === APPROVED_KEY_DIGEST.file && decl.kind === 'column'
  && decl.table === APPROVED_KEY_DIGEST.table && decl.text === APPROVED_KEY_DIGEST.declaration;

/**
 * Why this SQL breaks the rule, or an empty list. `fileName` decides whether the file may refer to the approved column at all;
 * the Trust presentation fingerprint is the other, older non-biometric meaning and keeps its own narrow treatment.
 */
export function fingerprintViolations(rawSql, fileName) {
  const violations = [];
  const declarations = fingerprintDeclarations(rawSql);
  let approved = 0;
  for (const decl of declarations) {
    if (isApproved(decl, fileName)) { approved += 1; continue; }
    violations.push(`${decl.kind} on ${decl.table ?? '(view)'}: ${decl.text}`);
  }
  if (approved > 1) violations.push('the approved declaration appears more than once');
  let code = stripSqlComments(rawSql).replace(/\bpresentation_fingerprint\b/g, '').replace(/\bv_fingerprint\b/g, '');
  if (KEY_DIGEST_REFERENCE_FILES.has(fileName)) {
    // every declaration above was checked, so what remains of these two spellings can only read or copy the approved column
    code = code.replace(/\bcredential_fingerprint\b/g, '').replace(/->>'fingerprint'/g, '');
  }
  if (/fingerprint/i.test(code) && !violations.length) violations.push('a mention of fingerprint outside the approved schema node');
  return violations;
}
