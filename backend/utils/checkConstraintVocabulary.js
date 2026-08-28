/**
 * Read the accepted values out of a PostgreSQL CHECK constraint definition.
 *
 * `pg_get_constraintdef` renders the same constraint in either of two shapes, depending on how the
 * literal was folded:
 *
 *   ANY (ARRAY['public'::text, 'withheld'::text])   ← quoted elements
 *   ANY ('{public,withheld}'::text[])               ← one brace-quoted array literal
 *
 * A parser that understands only the first returns NOTHING against the second. That is not a
 * cosmetic bug in a gate that verifies a privacy vocabulary: an empty read means "the database
 * accepts none of these values", which is indistinguishable from a constraint that was never
 * installed. Handling both shapes is what lets the caller tell those two apart.
 *
 * An unparseable definition yields an empty list on purpose, so a caller that treats "no values" as
 * a failure keeps failing closed.
 */
export function parseCheckVocabulary(definition) {
  const text = String(definition ?? '');
  const braced = /'\{([^}]*)\}'/.exec(text);
  if (braced) {
    return braced[1]
      .split(',')
      .map(entry => entry.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [...text.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
}
