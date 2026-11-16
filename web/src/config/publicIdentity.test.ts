/**
 * PC01-J-R1 §2 — public identity regression scan, adapted for the RX03-P1b footer-identity increment.
 *
 * Source: PR #222 `web/src/config/publicIdentity.test.ts` (edd6b745, unchanged at 082c73d8). The first
 * block is that test's identity contract, verbatim. PR #222's repository-wide scan is a release gate
 * for the whole One CarUp identity programme; this increment corrects only the footer, Contact, the
 * shell footers and the pages the new footer links to. So:
 *   1. every surface this increment owns is scanned with PR #222's own patterns and must be clean;
 *   2. the rest of the repository is RATCHETED: the files still carrying stale identity are listed by
 *      name, each with its owner decision. A new stale file fails; fixing one fails until it is removed
 *      from the list — so the list can only shrink, and nothing is hidden.
 * Comments are stripped first: each page documents what it removed, and a sentence naming a defect is
 * not the defect.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { PUBLIC_CONTACTS, PUBLIC_IDENTITY, CONTACT_PURPOSES, PUBLIC_LOCATION_LINE } from './publicIdentity'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

function codeOnly(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function walk(dir: string, accept: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, accept))
    else if (accept(full)) out.push(full)
  }
  return out
}

const isSource = (p: string) => /\.(tsx?|jsx?)$/.test(p) && !/\.test\.|\/test\/|__tests__|\/tests\//.test(p)

const SURFACES: Array<{ file: string; code: string }> = [
  ...walk(join(REPO, 'web/src'), isSource),
  ...walk(join(REPO, 'mobile/app'), isSource),
  ...walk(join(REPO, 'mobile/providers'), isSource),
  ...walk(join(REPO, 'mobile/components'), isSource),
  ...[join(REPO, 'mobile/utils/biometric.ts'), join(REPO, 'web/index.html'), join(REPO, 'backend/server.js')].filter(existsSync),
].map(file => ({ file: relative(REPO, file), code: codeOnly(readFileSync(file, 'utf8')) }))

const PRODUCT_FIXTURE = (file: string) => /web\/src\/data\/mockData\.ts$|web\/src\/pages\/dashboard\//.test(file)

/** PR #222's stale-identity patterns. */
const STALE: Array<{ name: string; pattern: RegExp; include?: (f: string) => boolean }> = [
  { name: 'carup.co.zw', pattern: /carup\.co\.zw/ },
  { name: 'phone', pattern: /\+263[\s-]?(242[\s-]?700[\s-]?000|242[\s-]?755[\s-]?889|772[\s-]?400[\s-]?121|773[\s-]?345[\s-]?678)/ },
  { name: 'street', pattern: /Samora Machel|Batanai|Jason Moyo Ave|Avondale|Office 402/i, include: f => !PRODUCT_FIXTURE(f) },
  { name: 'entity', pattern: /CarUp Zimbabwe|CarUp \(Pvt\)|CarUp Automotive Intelligence Private Limited|CarUp Technologies Ltd|CarUp Automotive Technologies/ },
  { name: 'hours', pattern: /Business Hours|Mon\s*-?\s*Fri:|\b0?8:00\s*(AM|-)/i, include: f => !PRODUCT_FIXTURE(f) && !/pages\/APIDocs\.tsx$/.test(f) },
]

function staleKinds(file: string, code: string): string[] {
  return STALE.filter(s => (s.include ? s.include(file) : true) && s.pattern.test(code)).map(s => s.name)
}

describe('the frozen public identity (PR #222, verbatim)', () => {
  it('matches the identity Email renders (one identity, not two)', () => {
    const email = readFileSync(join(REPO, 'backend/services/communication/emailExperience/emailBrandIdentity.js'), 'utf8')
    const field = (name: string) => new RegExp(`${name}: '([^']*)'`).exec(email)?.[1]
    expect(PUBLIC_IDENTITY.legalEntity).toBe(field('legalEntity'))
    expect(PUBLIC_IDENTITY.descriptor).toBe(field('corporateDescriptor'))
    expect(PUBLIC_IDENTITY.tagline).toBe(field('consumerTagline'))
    expect(PUBLIC_IDENTITY.headquarters).toBe(field('headquarters'))
    expect(PUBLIC_IDENTITY.regionalOffice).toBe(field('regionalOffice'))
    expect(PUBLIC_IDENTITY.tagline).toBe('Know the car. Trust the journey.')
    expect(PUBLIC_LOCATION_LINE).toBe('HQ: Tokyo, Japan · Regional office: Harare, Zimbabwe')
  })

  it('publishes exactly the certified functional aliases plus the inbound-certified questions@', () => {
    expect(Object.values(PUBLIC_CONTACTS).sort()).toEqual([
      'dpo@carup.dev', 'info@carup.dev', 'legal@carup.dev', 'press@carup.dev',
      'privacy@carup.dev', 'questions@carup.dev', 'security@carup.dev', 'support@carup.dev',
    ])
    expect(CONTACT_PURPOSES.map(p => p.purpose).sort()).toEqual(Object.keys(PUBLIC_CONTACTS).sort())
    expect(PUBLIC_IDENTITY.canonicalDomain).toBe('carup.dev')
    expect(PUBLIC_IDENTITY.legalEntity).toBe('CarUp Technologies')
    expect(PUBLIC_IDENTITY.descriptor).toBe('Automotive Intelligence & Trust Network')
  })

  it('carries no telephone number, street address, opening hours or social profile', () => {
    expect(JSON.stringify(PUBLIC_IDENTITY)).not.toMatch(/\+\d|street|avenue|ave\b|road|hours|facebook|instagram/i)
  })
})

/** The surfaces the RX03-P1b footer-identity increment owns or links to. */
const OWNED = [
  'web/src/config/publicIdentity.ts',
  'web/src/components/layout/ShowroomFooter.tsx',
  'web/src/components/layout/footerPresentation.ts',
  'web/src/components/layout/MainLayout.tsx',
  'web/src/components/shell/WorkspaceShell.tsx',
  'web/src/components/shell/PublicShell.tsx',
  'web/src/components/showroom/launch/ConversationsBand.tsx',
  'web/src/pages/Contact.tsx',
  'web/src/pages/About.tsx',
  'web/src/pages/Careers.tsx',
  'web/src/pages/PressKit.tsx',
  'web/src/pages/HelpCenter.tsx',
  'web/src/pages/TrustSafety.tsx',
  'web/src/pages/Support.tsx',
  'web/src/pages/Security.tsx',
  'web/index.html',
]

describe('surfaces this increment owns carry no stale identity', () => {
  it.each(OWNED)('%s', file => {
    const surface = SURFACES.find(s => s.file === file)
    expect(surface, `${file} is scanned`).toBeDefined()
    expect(staleKinds(file, surface!.code)).toEqual([])
  })

  it('no invented @carup.dev mailbox anywhere — every address is a certified one', () => {
    const allowed = new Set<string>(Object.values(PUBLIC_CONTACTS))
    const invented: string[] = []
    for (const { file, code } of SURFACES) {
      for (const m of code.matchAll(/[a-z0-9._+-]+@carup\.dev\b/gi)) {
        const address = m[0].toLowerCase()
        if (!allowed.has(address)) invented.push(`${file}: ${address}`)
      }
    }
    expect(invented).toEqual([])
  })

  it('the HTML shell carries the approved descriptor, not a possessive country claim', () => {
    const html = SURFACES.find(s => s.file === 'web/index.html')!.code
    expect(html).toContain('<title>CarUp — Automotive Intelligence &amp; Trust Network</title>')
    expect(html).not.toMatch(/Zimbabwe's Automotive Intelligence Platform/)
  })
})

/**
 * Remaining stale identity OUTSIDE this increment, each a named decision. The list may only shrink.
 *   - Footer.tsx: the flags-OFF ACCEPTED production footer — its identity correction needs its own
 *     review and Owner release decision (dispatch §10); the showroom footer is already corrected.
 *   - PrivacyPolicy / TermsOfService: legal text; corrected versions exist only in PR #222's OC-5R
 *     legal-truth commits (2681f14c, 2ecddc24, …) — legal/Owner review, not a footer change.
 *   - (KYCVerification and Login.tsx left the list in RX03-AUTH: demo login removed per PR #272, KYC prefill
 *     cleared per edd6b745; the /kyc retire-or-redirect decision itself stays with the Owner.)
 *   - mockData.ts / dashboard CustomerRecords.tsx: product fixtures.
 *   - backend/server.js legal pages and the native register screen: backend / native lanes.
 */
const OUTSTANDING_OWNER_DECISIONS: Record<string, string[]> = {
  'backend/server.js': ['carup.co.zw', 'entity'],
  'mobile/app/(auth)/register.tsx': ['phone'],
  'web/src/components/layout/Footer.tsx': ['carup.co.zw', 'phone', 'entity'],
  'web/src/data/mockData.ts': ['phone'],
  'web/src/pages/PrivacyPolicy.tsx': ['carup.co.zw', 'phone', 'street', 'entity', 'hours'],
  'web/src/pages/TermsOfService.tsx': ['carup.co.zw', 'street', 'entity'],
  'web/src/pages/dashboard/mechanic/CustomerRecords.tsx': ['phone'],
}

describe('ratchet: the remaining stale identity is exactly the named Owner-decision list', () => {
  it('no new file carries stale identity, and a corrected file must leave the list', () => {
    const actual: Record<string, string[]> = {}
    for (const { file, code } of SURFACES) {
      const kinds = staleKinds(file, code)
      if (kinds.length) actual[file] = kinds
    }
    expect(actual).toEqual(OUTSTANDING_OWNER_DECISIONS)
  })
})
