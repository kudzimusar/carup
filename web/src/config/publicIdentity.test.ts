/**
 * PC01-J-R1 §2 — public identity regression scan.
 *
 * The owner's Checkpoint 1 review found the website publishing "+263 242 700 000", "info@carup.co.zw",
 * "Harare, Zimbabwe" as the company's location and "© 2026 CarUp Zimbabwe", invented opening hours,
 * a Careers page with invented hubs and a fake application form, and a Press Kit with an invented
 * office address and two phone numbers. These assertions hold every user-visible source surface —
 * web, the native app and the backend's public legal pages — to the frozen identity, so none of it can
 * come back. Comments are stripped first: each page documents what it removed, and a sentence naming a
 * defect is not the defect.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

/** Every user-visible source surface: the website, the native app, the backend's public legal pages. */
const SURFACES: Array<{ file: string; code: string }> = [
  ...walk(join(REPO, 'web/src'), isSource),
  ...walk(join(REPO, 'mobile/app'), isSource),
  ...walk(join(REPO, 'mobile/providers'), isSource),
  ...walk(join(REPO, 'mobile/components'), isSource),
  join(REPO, 'mobile/utils/biometric.ts'),
  join(REPO, 'web/index.html'),
  join(REPO, 'backend/server.js'),
].map(file => ({ file: relative(REPO, file), code: codeOnly(readFileSync(file, 'utf8')) }))

/**
 * Product-fixture scope (CARUP_PUBLIC_IDENTITY_SAFE_REMEDIATION_PACKET §0.1): demo values inside the
 * marketplace demo data and signed-in dashboards are product fixtures, not company identity claims.
 */
const PRODUCT_FIXTURE = (file: string) => /web\/src\/data\/mockData\.ts$|web\/src\/pages\/dashboard\//.test(file)

function hits(pattern: RegExp, include: (file: string) => boolean = () => true): string[] {
  const found: string[] = []
  for (const { file, code } of SURFACES) {
    if (!include(file)) continue
    const lines = code.split('\n')
    lines.forEach((line, i) => { if (pattern.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`) })
  }
  return found
}

describe('the frozen public identity', () => {
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
  })

  it('carries no telephone number, street address, opening hours or social profile', () => {
    expect(JSON.stringify(PUBLIC_IDENTITY)).not.toMatch(/\+\d|street|avenue|ave\b|road|hours|facebook|instagram/i)
  })
})

describe('no stale identity on any user-visible surface', () => {
  it('no @carup.co.zw address — a domain CarUp does not use', () => {
    expect(hits(/carup\.co\.zw/)).toEqual([])
  })

  it('no invented or demo-seed telephone number', () => {
    expect(hits(/\+263[\s-]?(242[\s-]?700[\s-]?000|242[\s-]?755[\s-]?889|772[\s-]?400[\s-]?121|773[\s-]?345[\s-]?678)/)).toEqual([])
  })

  it('no invented street address or office claim', () => {
    expect(hits(/Samora Machel|Batanai|Jason Moyo Ave|Avondale|Office 402/i, f => !PRODUCT_FIXTURE(f))).toEqual([])
  })

  it('no CarUp entity variant other than "CarUp Technologies"', () => {
    expect(hits(/CarUp Zimbabwe|CarUp \(Pvt\)|CarUp Automotive Intelligence Private Limited|CarUp Technologies Ltd|CarUp Automotive Technologies/)).toEqual([])
  })

  it('no unverified registration number or patent claim', () => {
    expect(hits(/14838\/2025|patents/i)).toEqual([])
  })

  it('no demo persona presented on an institutional surface', () => {
    const institutional = (f: string) => !PRODUCT_FIXTURE(f) && !/pages\/auth\/Register\.tsx$/.test(f)
    expect(hits(/Tendai Moyo|Sarah Chikomo|James Ncube|Ayesha Khan|Rudo Mutasa|Chipo Sibanda/, institutional)).toEqual([])
  })

  it('no invented business hours', () => {
    expect(hits(/Business Hours|Mon\s*-?\s*Fri:|\b0?8:00\s*(AM|-)/i, f => !PRODUCT_FIXTURE(f) && !/pages\/APIDocs\.tsx$/.test(f))).toEqual([])
  })

  it('no invented @carup.dev mailbox — every address is a certified one', () => {
    const allowed = new Set<string>(Object.values(PUBLIC_CONTACTS))
    const invented: string[] = []
    for (const { file, code } of SURFACES) {
      for (const m of code.matchAll(/[a-z0-9._+-]+@carup\.dev\b/gi)) {
        const address = m[0].toLowerCase()
        // Transport sender identities (auth@mail.carup.dev) are a different subdomain and are not matched.
        if (!allowed.has(address)) invented.push(`${file}: ${address}`)
      }
    }
    expect(invented).toEqual([])
  })

  it('the native app names no real bank as a partner and shows no internal codename', () => {
    const native = (f: string) => f.startsWith('mobile/')
    expect(hits(/\bCBZ\b|CarUp Kimi/, native)).toEqual([])
  })

  it('the backend public legal pages name the frozen entity and certified contacts', () => {
    const server = SURFACES.find(s => s.file === 'backend/server.js')!.code
    expect(server).toContain('<footer>CarUp Technologies - legal@carup.dev</footer>')
    expect(server).not.toMatch(/legal@carup\.co\.zw|privacy@carup\.co\.zw|support@carup\.co\.zw/)
  })

  it('the HTML shell carries the approved descriptor, not a possessive country claim', () => {
    const html = SURFACES.find(s => s.file === 'web/index.html')!.code
    expect(html).toContain('<title>CarUp — Automotive Intelligence &amp; Trust Network</title>')
    expect(html).not.toMatch(/Zimbabwe's Automotive Intelligence Platform/)
  })
})
