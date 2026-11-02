/**
 * Is this database error "the table/relation is not deployed here"?
 *
 * Enrichment from a newer migration must degrade to "contributes nothing" when its table does not
 * exist yet (a backend deployed ahead of its migration, or a test world built before it) — and ONLY
 * then. Any other failed read still fails: an unreadable table is not an empty one.
 */
export function isAbsentRelation(error) {
  if (!error) return false;
  if (String(error.code) === '42P01') return true;
  return /relation ".*" does not exist|could not find the table|schema cache|does not exist/i.test(String(error.message || error));
}

export default { isAbsentRelation };
