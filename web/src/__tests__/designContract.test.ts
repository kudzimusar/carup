/**
 * The root `DESIGN.md` gate.
 *
 * WHY THIS FILE EXISTS. `DESIGN.md` was ADDED to the repository on 2026-09-04 (merge `bb9d9900`).
 * The Service Network Foundation lane opened on 2026-08-29 — six days earlier. So Service Network
 * was never certified against the global design contract: it could not have been, because the
 * contract did not exist when its surfaces were specified. It became functionally and responsively
 * usable through owner UAT without any global-design gate ever running.
 *
 * `DESIGN.md` §24 says a UI PR "must state which DESIGN.md sections it implements" and "is not
 * mergeable if it knowingly introduces a new legacy pattern". Nothing enforced that. A prose
 * contract that no test reads is a contract that the next agent will not know exists.
 *
 * WHAT THIS CAN AND CANNOT DO. Most of `DESIGN.md` is editorial judgement — "editorial rather than
 * generic SaaS", "visually confident but operationally calm" — and no test should pretend to judge
 * that. This gate enforces only the parts that are *mechanically decidable*, and it names the
 * section for each, so a failure sends the reader to the clause rather than to a number:
 *
 *   §4.3  no arbitrary width changes between connected routes
 *   §6.2  object/workflow pages carry a back/up action
 *   §8.1  no fake zeros
 *   §10   touch targets, and no page-level horizontal overflow primitives
 *   §20   the legacy-pattern budget does not grow
 *
 * Everything else stays a human review, which is honest about what a test can see.
 */
import { describe, it, expect } from 'vitest'

/** Raw sources for the surfaces a feature declares as its own. */
const SOURCES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * The Service Network surface set, declared here so the gate is explicit about its scope.
 * A new Service Network page that is not listed here is itself a finding — see the last test.
 */
const SERVICE_NETWORK_SURFACES = [
  '/src/pages/GarageDirectory.tsx',
  '/src/pages/GarageDetail.tsx',
  '/src/pages/ServiceLink.tsx',
  '/src/pages/dashboard/owner/ServiceRequests.tsx',
  '/src/pages/dashboard/owner/ServiceHistory.tsx',
  '/src/pages/dashboard/garage/GarageWorkspace.tsx',
  '/src/pages/dashboard/garage/GarageCaseDetail.tsx',
  '/src/pages/dashboard/garage/GarageCustomers.tsx',
  '/src/pages/dashboard/garage/GarageProfileEditor.tsx',
]

/** The connected workspace routes of one workflow — §4.3 judges these together. */
const GARAGE_WORKFLOW = [
  '/src/pages/dashboard/garage/GarageWorkspace.tsx',
  '/src/pages/dashboard/garage/GarageCaseDetail.tsx',
  '/src/pages/dashboard/garage/GarageCustomers.tsx',
  '/src/pages/dashboard/garage/GarageProfileEditor.tsx',
  '/src/pages/dashboard/owner/ServiceRequests.tsx',
]

const src = (path: string): string => {
  const text = SOURCES[path]
  if (text === undefined) throw new Error(`design gate: ${path} is declared but does not exist`)
  return String(text)
}

describe('DESIGN.md §4.3 — connected routes do not change width arbitrarily', () => {
  it('every garage workflow surface shares one page container', () => {
    // Before this gate the workflow used max-w-5xl, max-w-3xl, max-w-3xl and max-w-2xl: a garage
    // operator moving Workshop -> job -> Customers watched the column jump three times in one task.
    const offenders = GARAGE_WORKFLOW.filter((p) => !src(p).includes('SN_PAGE'))
    expect(offenders, `these connected routes do not use the shared page container:\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('and none of them re-declares its own page width', () => {
    const offenders: string[] = []
    for (const p of GARAGE_WORKFLOW) {
      // A width on the page container itself. Inner reading columns are declared via the shared
      // SN_FORM_COLUMN / SN_DETAIL_COLUMN constants, which is the deliberate case §4.3 allows.
      const m = src(p).match(/className="[^"]*max-w-\w+ mx-auto/g)
      if (m) offenders.push(`${p}: ${m.join(', ')}`)
    }
    expect(offenders, `hardcoded page widths reintroduce the drift:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('DESIGN.md §6.2 — an object/workflow page says how to go back', () => {
  it('every Service Network detail surface offers a back or up action', () => {
    const detailSurfaces = [
      '/src/pages/dashboard/garage/GarageCaseDetail.tsx',
      '/src/pages/dashboard/garage/GarageCustomers.tsx',
      '/src/pages/dashboard/garage/GarageProfileEditor.tsx',
    ]
    const offenders = detailSurfaces.filter((p) => {
      const text = src(p)
      return !(/ArrowLeft|Back to|breadcrumb/i.test(text))
    })
    expect(offenders, `no back/up affordance — §6.2 "no dead-end pages":\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('DESIGN.md §8.1 — no fake zeros', () => {
  it('no Service Network surface renders a bare 0 as a metric fallback', () => {
    const offenders: string[] = []
    for (const p of SERVICE_NETWORK_SURFACES) {
      src(p).split('\n').forEach((line, i) => {
        // `?? 0` / `|| 0` as a DISPLAY fallback turns "unknown" into a measured zero. Arithmetic
        // accumulators are a different thing, so only flag it inside JSX interpolation.
        if (/\{[^}]*(\?\?|\|\|)\s*0\s*\}/.test(line)) offenders.push(`${p}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, `§8.1: unknown must not be rendered as 0:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('DESIGN.md §10 — responsive contract', () => {
  it('interactive controls declare an adequate touch target', () => {
    const offenders: string[] = []
    for (const p of SERVICE_NETWORK_SURFACES) {
      const text = src(p)
      // Every <Button> or <select> on these surfaces should carry an explicit min height; the
      // codebase convention is min-h-11 (44px), which is the accessibility floor.
      const buttons = (text.match(/<Button[^>]*>/g) || []).filter((b) => !b.includes('min-h-') && !b.includes('asChild'))
      if (buttons.length) offenders.push(`${p}: ${buttons.length} control(s) without a min height`)
    }
    expect(offenders, `§10 touch targets:\n${offenders.join('\n')}`).toEqual([])
  })

  it('no surface pins a viewport-exceeding fixed width', () => {
    const offenders: string[] = []
    for (const p of SERVICE_NETWORK_SURFACES) {
      // A FIXED w-[NNNpx] wider than a small phone is how horizontal page overflow gets in.
      // `max-w-[1440px]` is the §4.3 canonical band and must not be flagged — the negative
      // lookbehind is what separates "this box is exactly 1440px" from "this box is at most 1440px".
      const m = src(p).match(/(?<!max-)\bw-\[(\d{3,})px\]/g)
      if (m) {
        const tooWide = m.filter((w) => Number(w.replace(/\D/g, '')) > 360)
        if (tooWide.length) offenders.push(`${p}: ${tooWide.join(', ')}`)
      }
    }
    expect(offenders, `§10 "no horizontal page overflow":\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('DESIGN.md §20 — the legacy-pattern budget does not grow', () => {
  /**
   * §20 deprecates "every section as Card + CardContent + card-shadow" and "large stacks of equally
   * weighted rounded cards". The Service Network surfaces were built entirely from that pattern,
   * BEFORE DESIGN.md existed.
   *
   * Rewriting nine working, UAT-passed pages to chase a visual standard is a redesign, and a
   * redesign is not what a convergence audit is for. So this is a RATCHET, not a cliff: the current
   * count is recorded, and it may go down but never up. New Service Network work has to use the
   * global composition; existing pages become migration targets, which is exactly what §20 calls
   * them ("Existing legacy surfaces are migration targets, not reference implementations").
   */
  const LEGACY_CARD_BUDGET: Record<string, number> = {
    '/src/pages/GarageDirectory.tsx': 3,
    '/src/pages/GarageDetail.tsx': 6,
    '/src/pages/ServiceLink.tsx': 1,
    '/src/pages/dashboard/owner/ServiceRequests.tsx': 3,
    '/src/pages/dashboard/owner/ServiceHistory.tsx': 5,
    '/src/pages/dashboard/garage/GarageWorkspace.tsx': 3,
    '/src/pages/dashboard/garage/GarageCaseDetail.tsx': 8,
    '/src/pages/dashboard/garage/GarageCustomers.tsx': 3,
    '/src/pages/dashboard/garage/GarageProfileEditor.tsx': 3,
  }

  it('no surface exceeds its recorded legacy-card budget', () => {
    const offenders: string[] = []
    for (const [path, budget] of Object.entries(LEGACY_CARD_BUDGET)) {
      const count = (src(path).match(/card-shadow/g) || []).length
      if (count > budget) offenders.push(`${path}: ${count} card-shadow uses, budget ${budget}`)
    }
    expect(offenders, `§20: the legacy card pattern may shrink, never grow:\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('the budget itself is honest — every entry matches or exceeds reality', () => {
    // If a page is migrated the budget must be lowered with it, or the ratchet silently loosens.
    const stale: string[] = []
    for (const [path, budget] of Object.entries(LEGACY_CARD_BUDGET)) {
      const count = (src(path).match(/card-shadow/g) || []).length
      if (count < budget) stale.push(`${path}: budget ${budget} but only ${count} in use — lower it`)
    }
    expect(stale, `a loose budget is a gate that no longer holds:\n${stale.join('\n')}`).toEqual([])
  })
})

describe('DESIGN.md §24 — the gate covers what it claims to cover', () => {
  it('every Service Network surface is declared to this gate', () => {
    // A new page under pages/dashboard/garage/ that nobody added here would be ungoverned, and the
    // whole point of this file is that a surface cannot quietly escape the contract.
    const discovered = Object.keys(SOURCES).filter(
      (p) => p.startsWith('/src/pages/dashboard/garage/') && !p.includes('.test.'),
    )
    const undeclared = discovered.filter((p) => !SERVICE_NETWORK_SURFACES.includes(p))
    expect(undeclared, `these surfaces exist but no design gate covers them:\n${undeclared.join('\n')}`)
      .toEqual([])
  })

  it('DESIGN.md is present and is the document this gate refers to', () => {
    // If DESIGN.md is renamed or removed, this gate is meaningless and should say so loudly.
    const design = import.meta.glob('/../DESIGN.md', { query: '?raw', import: 'default', eager: true })
    const text = String(Object.values(design)[0] ?? '')
    expect(text, 'root DESIGN.md must exist').toBeTruthy()
    expect(text).toContain('CarUp Global Product Design System')
    // The sections this gate enforces must still exist under the numbers it cites.
    for (const clause of ['### 4.3 Layout', '### 6.2 Local navigation', '### 8.1 No fake zeros', '## 10. Responsive design contract', '## 20. Legacy UI deprecation']) {
      expect(text, `DESIGN.md no longer contains "${clause}" — this gate cites it`).toContain(clause)
    }
  })
})
