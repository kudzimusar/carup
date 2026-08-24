/**
 * Issue #164 Phase 8, Cluster G — content integrity for `/blog` and `/press`.
 *
 * Every assertion here fails on the physically-tested baseline `993c1179`. There was no test, lint
 * rule or CI gate of any kind constraining what these two pages could claim, which is why a hand
 * removal of some fabrications in an earlier commit left everything it missed in place.
 *
 * This reads the SOURCE of both pages and the editorial module, because that is where the claims
 * live. It is deliberately about institutions, people, engagement metrics and promised service
 * levels — the four shapes in which unattributed prose does real damage on these surfaces.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { EDITORIAL_ARTICLES } from './articles'
import { namesInstitution, INSTITUTIONAL_TERMS } from './governance'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8')

const BLOG = read('../../pages/Blog.tsx')
const PRESS = read('../../pages/PressKit.tsx')

/** Comment lines explain what was removed and legitimately quote it. Claims live in code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const BLOG_CODE = withoutComments(BLOG)
const PRESS_CODE = withoutComments(PRESS)

describe('editorial articles are classified', () => {
  it('every article carries a classification', () => {
    for (const article of EDITORIAL_ARTICLES) {
      expect(article.classification, `${article.id} must be classified`).toBeTruthy()
      expect(['governed_capability', 'sourced_editorial', 'future_vision', 'unavailable'])
        .toContain(article.classification.kind)
    }
  })

  it('a governed_capability names the shipped behaviour it describes', () => {
    for (const article of EDITORIAL_ARTICLES) {
      if (article.classification.kind !== 'governed_capability') continue
      expect(article.classification.capability.length, `${article.id}`).toBeGreaterThan(20)
    }
  })

  it('a sourced_editorial claim carries a resolvable source', () => {
    for (const article of EDITORIAL_ARTICLES) {
      if (article.classification.kind !== 'sourced_editorial') continue
      const { source } = article.classification
      expect(source.publisher, `${article.id}`).toBeTruthy()
      expect(source.url, `${article.id}`).toMatch(/^https:\/\//)
      expect(source.retrieved, `${article.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  // THE REGRESSION. Five articles asserted a ZINARA third-generation portal, ANPR toll enforcement,
  // CarUp writing into the ZINARA database, and named banks offering ZiG finance at specific rates.
  it('no article names a real institution unless the claim is sourced or clearly a concept', () => {
    for (const article of EDITORIAL_ARTICLES) {
      const prose = [article.title, article.excerpt, article.description, ...article.content].join(' ')
      if (!namesInstitution(prose)) continue
      expect(
        ['sourced_editorial', 'future_vision'],
        `${article.id} names an institution (${INSTITUTIONAL_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(prose))}) `
        + 'and must be sourced or labelled a concept',
      ).toContain(article.classification.kind)
    }
  })

  it('an unavailable article publishes no body rather than an unsourced one', () => {
    for (const article of EDITORIAL_ARTICLES) {
      if (article.classification.kind !== 'unavailable') continue
      expect(article.content, `${article.id}`).toEqual([])
    }
  })

  it('no article is bylined to an invented person', () => {
    for (const article of EDITORIAL_ARTICLES) {
      if (article.byline.kind === 'carup_editorial') continue
      // A named byline must be a real, checkable person.
      expect(article.byline.profileUrl, `${article.id}`).toMatch(/^https:\/\//)
    }
  })
})

describe('/blog publishes no fabricated engagement or personas', () => {
  it('carries no view or like counters', () => {
    expect(BLOG_CODE).not.toMatch(/\.views\b/)
    expect(BLOG_CODE).not.toMatch(/\.likes\b/)
  })

  it('seeds no reader comments', () => {
    // Three invented comments attributed to named individuals were hardcoded into useState.
    expect(BLOG_CODE).not.toMatch(/zinara-guide-2026'\s*:\s*\[/)
    expect(BLOG_CODE, 'the comment store must initialise empty')
      .toMatch(/setComments\] = useState<[\s\S]*?>\(\{\}\)/)
  })

  it('claims no subscriber count and no unexplained compliance standard', () => {
    expect(BLOG_CODE).not.toMatch(/8,500\+/)
    expect(BLOG_CODE).not.toMatch(/SADC compliance standards verified/i)
  })

  it('publishes no market index it does not measure', () => {
    expect(BLOG_CODE).not.toMatch(/Live Market Metrics/)
    expect(BLOG_CODE).not.toMatch(/from last Q/)
  })

  it('publishes no licensing rate under an authority badge', () => {
    expect(BLOG_CODE).not.toMatch(/Official Rates/)
    expect(BLOG_CODE).not.toMatch(/mandated for 2026/)
  })
})

describe('/press names no invented people and promises no service level', () => {
  // Two named "PR officers" carried real-format @carup.co.zw addresses, direct mobile numbers and a
  // green "Online / Direct" presence dot, behind a form that transmits nothing.
  it('publishes only a role-based press address', () => {
    const personalAddresses = PRESS_CODE.match(/[a-z]+\.[a-z]+@carup\.co\.zw/gi) || []
    expect(personalAddresses, 'no individual @carup.co.zw identities may be published').toEqual([])
    expect(PRESS_CODE).toMatch(/press@carup\.co\.zw/)
  })

  it('shows no presence indicator for people who are not there', () => {
    expect(PRESS_CODE).not.toMatch(/Online \/ Direct/)
  })

  it('promises no response time behind a form that does not transmit', () => {
    expect(PRESS_CODE).not.toMatch(/within 2 hours/i)
    expect(PRESS_CODE).not.toMatch(/transmitted successfully/i)
  })

  it('does not fabricate a downloadable asset', () => {
    expect(PRESS_CODE).not.toMatch(/Simulated brand asset package content/)
    expect(PRESS_CODE).not.toMatch(/new Blob\(/)
    expect(PRESS_CODE).not.toMatch(/_bundle\.zip/)
  })

  it('does not badge unverified assets as verified', () => {
    expect(PRESS_CODE).not.toMatch(/Asset Verified/)
    expect(PRESS_CODE).not.toMatch(/CU_VERIFIED_ASSET/)
  })

  it('asserts no registry integration and no valuation model', () => {
    expect(PRESS_CODE).not.toMatch(/licensing records with the/i)
    expect(PRESS_CODE).not.toMatch(/AI-assisted valuation models/i)
    expect(PRESS_CODE).not.toMatch(/cannot be forged/i)
    expect(PRESS_CODE).not.toMatch(/Decentralized Trust Ledger/i)
  })
})

describe('the surfaces stay live and keep their design', () => {
  // The remedy for fabricated content is governance, not deletion. These pages must not be emptied.
  it('/blog still renders articles, categories, comments and the newsletter card', () => {
    expect(EDITORIAL_ARTICLES.length).toBeGreaterThanOrEqual(3)
    for (const marker of ['selectedArticle', 'categories', 'Audience Discussions', 'newsletter']) {
      expect(BLOG.toLowerCase(), `Blog must keep ${marker}`).toContain(marker.toLowerCase())
    }
  })

  it('/press still renders the media hub, asset vault and contact surfaces', () => {
    for (const marker of ['handleDownload', 'press-contact', 'Brand asset', 'handleFormSubmit']) {
      expect(PRESS, `PressKit must keep ${marker}`).toContain(marker)
    }
  })
})
