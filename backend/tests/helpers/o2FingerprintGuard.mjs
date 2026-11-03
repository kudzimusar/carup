/**
 * The O2-X4 fingerprint guard's one schema exception (PAY-05-R1; Moderator directive on issue #255).
 *
 * A word-level exclusion cannot tell a permitted credential digest from a prohibited column of the same name in the same file.
 * The exception is therefore one schema node (this table, this exact column declaration, this file) and, in the two files that may
 * touch that column, a closed list of reviewed lines. Nothing rests on parsing SQL: a line that names a fingerprint and is not on
 * that list is a violation, however it is spelled. Only a whole-line comment is exempt. The declaration scanner below only
 * names the common cases more precisely, and catches Trust's name being declared.
 *
 * This guards biometric storage. It does not describe biometric architecture, which it leaves alone.
 */
export const APPROVED_KEY_DIGEST = Object.freeze({
  file: '20261103100000_carup_pay05_zimbabwe_paynow_collections.sql',
  table: 'public.pay05_merchant_integrations',
  declaration: "credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$')",
});
/**
 * Exactly the lines, whitespace-normalized, that may name the column in each reviewed file: no fewer, no more, each as often as
 * listed. Changing one is a deliberate review, here. Every one only reads or copies the 16-hex digest, a hash of a Paynow key.
 */
export const KEY_DIGEST_REVIEWED_LINES = Object.freeze({
  [APPROVED_KEY_DIGEST.file]: Object.freeze([
    `${APPROVED_KEY_DIGEST.declaration},`,
    'OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint',
    "'credential_fingerprint', p_row.credential_fingerprint, 'status', p_row.status, 'registered_by', p_row.registered_by,",
    'credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role)',
    "v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),",
    "'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));",
    "OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN",
  ]),
  '20261104100000_carup_pay05_r1_financial_integrity.sql': Object.freeze([
    'OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint',
    "OR coalesce(v_item->'probe'->>'credential_fingerprint', '') <> coalesce(v_item->>'fingerprint', '')",
    'credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role, test_auth_email)',
    "v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),",
    "'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));",
    "OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN",
  ]),
});

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
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
 * Why this SQL breaks the rule, or an empty list. Line by line and fail closed: a line naming a fingerprint is allowed only if it is a
 * whole-line comment, a reviewed line of this file, or reads Trust's presentation fingerprint, the older non-biometric meaning.
 */
export function fingerprintViolations(rawSql, fileName) {
  const violations = [];
  let approved = 0;
  for (const decl of fingerprintDeclarations(rawSql)) {
    if (isApproved(decl, fileName)) { approved += 1; continue; }
    violations.push(`${decl.kind} on ${decl.table ?? '(view)'}: ${decl.text}`);
  }
  if (approved > 1) violations.push('the approved declaration appears more than once');
  if (fileName === APPROVED_KEY_DIGEST.file && approved === 0) violations.push('the approved declaration is not on its approved table');
  const reviewed = KEY_DIGEST_REVIEWED_LINES[fileName] ?? null;
  const unused = reviewed ? [...reviewed] : [];
  // PostgreSQL ends a line comment at a carriage return as well as at a newline
  for (const line of rawSql.split(/[\r\n]+/)) {
    const text = normalize(line);
    if (text.startsWith('--') || !/fingerprint/i.test(text)) continue;
    const at = unused.indexOf(text);
    if (at >= 0) { unused.splice(at, 1); continue; }
    if (!/fingerprint/i.test(text.replace(/\bpresentation_fingerprint\b/g, '').replace(/\bv_fingerprint\b/g, ''))) continue;
    violations.push(`a mention of fingerprint outside the reviewed lines: ${text.slice(0, 160)}`);
  }
  for (const line of unused) violations.push(`a reviewed line is missing, so this file changed without review: ${line.slice(0, 160)}`);
  return violations;
}
