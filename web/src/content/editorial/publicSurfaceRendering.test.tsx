/**
 * Issue #164 — D3: public content surfaces must RENDER truthfully.
 *
 * Both defects here were found by physically reading the deployed pages, not the source:
 *
 *   /press  → "…issue in Zimbabwe\'s automotive landscape"   (literal backslash-apostrophe)
 *             "Enquiries are read by CarUp’s communications team."
 *   /blog   → "CarUp’s editorial desk publishes… Sign-up is not open yet — when it is"
 *   /privacy→ "SECTION_ID: BLOCKCHAIN_TRUST_LEDGER"
 *             "PartSentry Blockchain Hashing — …cryptographically hashed onto the public registry
 *              ledger", a capability the codebase elsewhere explicitly disclaims.
 *
 * The escape defects are invisible in source review: `’` inside a QUOTED JS STRING is a correct
 * escape, and the same characters as a JSX TEXT CHILD are literal output. Only rendering
 * distinguishes them, so these tests render.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

import PressKit from '../../pages/PressKit'
import Blog from '../../pages/Blog'
import PrivacyPolicy from '../../pages/PrivacyPolicy'
import Landing from '../../pages/Landing'

function renderedText(el: ReactElement): string {
  const { container } = render(<MemoryRouter>{el}</MemoryRouter>)
  return container.textContent ?? ''
}

/** Escape sequences a READER would see. Not a source check — this runs on rendered output. */
function escapeLeaks(text: string): string[] {
  const out: string[] = []
  for (const re of [/\\'/g, /\\u[0-9a-fA-F]{4}/g, /\\n(?![a-z])/g]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      out.push(text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 25).replace(/\s+/g, ' '))
    }
  }
  return out
}

describe('D3 — rendered public copy carries no raw escape sequences', () => {
  it('/press renders no literal escape sequences', () => {
    expect(escapeLeaks(renderedText(<PressKit />))).toEqual([])
  })

  it('/blog renders no literal escape sequences', () => {
    expect(escapeLeaks(renderedText(<Blog />))).toEqual([])
  })

  it('/privacy renders no literal escape sequences', () => {
    expect(escapeLeaks(renderedText(<PrivacyPolicy />))).toEqual([])
  })

  it('the typographic characters actually arrive (the fix is not just deletion)', () => {
    const press = renderedText(<PressKit />)
    // The real curly apostrophe, not a stripped-out gap.
    expect(press).toContain('CarUp’s communications team')
    expect(press).toContain('Zimbabwe’s automotive landscape')
  })
})

describe('D3 — no product surface claims a blockchain', () => {
  const surfaces: Array<[string, ReactElement]> = [
    ['/privacy', <PrivacyPolicy />],
    ['/press', <PressKit />],
    ['/blog', <Blog />],
  ]

  for (const [name, el] of surfaces) {
    it(`${name} renders no "blockchain" wording`, () => {
      expect(renderedText(el)).not.toMatch(/blockchain/i)
    })
  }

  it('/privacy does not claim the ledger is a public registry or externally published', () => {
    const text = renderedText(<PrivacyPolicy />)
    // The old copy said metrics were "hashed onto the public registry ledger".
    expect(text).not.toMatch(/public registry ledger/i)
    // ...and it must still describe what CarUp actually operates.
    expect(text).toMatch(/audit ledger/i)
  })

  it('/privacy states the ledger is internal and not externally published', () => {
    const text = renderedText(<PrivacyPolicy />)
    expect(text).toMatch(/not published to any external or public network/i)
  })

  it('/privacy makes no contradicting public-ledger claim elsewhere on the page', () => {
    // The first D3 pass rewrote the section chrome and intro but left a rendered column heading
    // reading "Public Ledger (Immutably Hashed)" eleven lines below the new denial — so the page
    // asserted both at once. A denial is worth nothing while the contradiction still renders.
    const text = renderedText(<PrivacyPolicy />)
    expect(text).not.toMatch(/public ledger/i)
    expect(text).not.toMatch(/distributed ledger(?!\s+and it is not)/i)
    expect(text).not.toMatch(/anyone can audit/i)
    // ...and the honest half still describes what CarUp actually operates.
    expect(text).toMatch(/marketplace-visible record/i)
  })
})

describe('D1 — unsupported government-approval claims never render', () => {
  // Owner decision (Option 3): duty_cleared / zimra_verified / cid_clear are suppressed because no
  // legitimate writer exists for any of them. police_verified is the sharpest case: its only writer
  // records "was reported stolen, then recovered", so a "Police Checked" / "CID Clear" label
  // asserted a clean record on the strength of a theft report.
  //
  // These assert on RENDERED output, because the claims reached users through four independent
  // routes — the tag array, the flat booleans, a Landing filter chip, and a label derived directly
  // from the raw column on the Marketplace card. Source-level checks kept missing one of them.
  const forbidden = [/zimra\s*verified/i, /duty\s*cleared/i, /cid\s*clear/i, /police\s*checked/i]

  it('the Landing page offers no unsupported government-approval filter chip', () => {
    const text = renderedText(<Landing />)
    for (const pattern of forbidden) expect(text).not.toMatch(pattern)
  })

  it('the Landing page still offers the governed chips it can substantiate', () => {
    const text = renderedText(<Landing />)
    expect(text).toMatch(/low mileage/i)
    expect(text).toMatch(/recently imported/i)
  })
})
