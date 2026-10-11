import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'Blog.tsx'), 'utf8')

// /blog is hidden from launch navigation but reachable directly (OC-LAUNCH R1 public-truth sweep).
describe('Blog makes no claim it cannot keep', () => {
  it('does not pretend to post comments it never stores', () => {
    expect(SRC).not.toContain('Comment added successfully')
    expect(SRC).not.toContain('Submit Comment')
    expect(SRC).toContain('Comments are not open yet')
  })
  it('shares only the canonical carup.dev blog page, never the current host or a missing article route', () => {
    expect(SRC).not.toMatch(/window\.location\.origin\s*\+\s*'\/blog\//)
    expect(SRC).not.toContain('${window.location.origin}/blog/')
    expect(SRC).toContain('${CANONICAL_ORIGIN}/blog')
  })
  it('labels unsourced regulatory guidance as unverified', () => {
    expect(SRC).toContain('General guidance, not verified by CarUp')
  })
})
