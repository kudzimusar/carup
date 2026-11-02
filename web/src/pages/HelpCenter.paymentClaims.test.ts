/**
 * OC-5R-PROV-01 C4 — the Help Center may not claim a payment rail CarUp does not run.
 *
 * No online payment method is live: billing fails closed on every deployment without an approved
 * provider, and Paynow exists only as a test-mode wire profile. The Help Center told customers
 * "EcoCash, ZIPIT, RTGS ... for CarUp plans" and had its assistant say "We accept multi-currency
 * payments! ... ZiG (via EcoCash, ZIPIT, or RTGS bank transfer)". Every string that names a rail
 * must now say it is NOT available. This reads the page SOURCE, like the editorial integrity test,
 * because that is where the claims live.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(path.resolve(here, 'HelpCenter.tsx'), 'utf8')
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

const RAILS = /\b(eco\s?cash|inn\s?bucks|zipit|rtgs)\b/i
const NEGATED = /\b(no|not|never|cannot|isn't|aren't|unavailable)\b/i

/** Every quoted string literal in the page. */
function literals(code: string): string[] {
  const out: string[] = []
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  for (const m of code.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

describe('Help Center payment claims (C4)', () => {
  const named = literals(CODE).filter((l) => RAILS.test(l))

  it('finds the strings it is checking (anti-vacuity)', () => {
    expect(named.length).toBeGreaterThan(0)
  })

  it('every sentence that names a payment rail says it is not available', () => {
    // A bare keyword (a search tag, a matcher) is not a claim; a sentence is.
    const sentences = named.filter((l) => /\s/.test(l.trim()))
    expect(sentences.length).toBeGreaterThan(0)
    for (const sentence of sentences) {
      expect(NEGATED.test(sentence), `claims a payment rail without qualifying it: "${sentence}"`).toBe(true)
    }
  })

  it('the payments answer and the assistant both state that no online payment method is live', () => {
    const live = literals(CODE).filter((l) => /no online payment method/i.test(l))
    expect(live.length).toBeGreaterThanOrEqual(3)
    expect(CODE).not.toMatch(/we accept multi-currency payments/i)
  })
})
