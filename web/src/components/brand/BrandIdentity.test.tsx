import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandIdentity } from './BrandIdentity'
import { BRAND_ASSETS, type BrandRole, type BrandSurface } from './brandAssets'
import ledger from '@/assets/brand/option5/ASSET_LEDGER.json'

const ASSET_DIR = join(__dirname, '../../assets/brand/option5')

describe('Option 5 asset custody', () => {
  it('every shipped SVG is listed in the ledger with its exact SHA-256 and size', () => {
    const shipped = readdirSync(ASSET_DIR).filter(name => name.endsWith('.svg')).sort()
    const listed = ledger.assets.map(asset => asset.file).sort()
    expect(shipped).toEqual(listed)
    for (const asset of ledger.assets) {
      const bytes = readFileSync(join(ASSET_DIR, asset.file))
      expect(bytes.length, asset.file).toBe(asset.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), asset.file).toBe(asset.sha256)
    }
  })

  it('the light and dark logo variants are genuinely different files (no renamed duplicates)', () => {
    const hashOf = (file: string) => ledger.assets.find(asset => asset.file === file)?.sha256
    for (const role of ['logo', 'stacked', 'wordmark'] as BrandRole[]) {
      const light = hashOf(BRAND_ASSETS[role].light.file)
      const dark = hashOf(BRAND_ASSETS[role].dark.file)
      expect(light).toBeTruthy()
      expect(dark).toBeTruthy()
      expect(light, `${role} light vs dark`).not.toBe(dark)
    }
  })

  it('no asset embeds a remote reference, raster or script', () => {
    for (const asset of ledger.assets) {
      const text = readFileSync(join(ASSET_DIR, asset.file), 'utf8')
      expect(text, asset.file).not.toMatch(/drive\.google|googleusercontent|<image|<script|href="https?:/i)
    }
  })

  it('every Option 5 import ships the file verbatim (?no-inline): Vite re-encodes inlined SVG data URIs', () => {
    // Small SVGs (< 4 KB) would otherwise be inlined as rewritten data URIs — same geometry, different
    // bytes — and the served identity could no longer be hash-checked against the official package.
    const sources = ['brandAssets.ts', 'brandFavicon.ts']
      .map(name => join(__dirname, name))
      .filter(path => { try { readFileSync(path); return true } catch { return false } })
    expect(sources.length).toBeGreaterThan(0)
    for (const path of sources) {
      const imports = readFileSync(path, 'utf8').match(/from '@\/assets\/brand\/option5\/[^']+'/g) ?? []
      expect(imports.length, path).toBeGreaterThan(0)
      for (const line of imports) expect(line, path).toMatch(/\?no-inline'$/)
    }
  })
})

describe('BrandIdentity', () => {
  it.each([
    ['logo', 'light', 'carup-logo-horizontal-on-light.svg'],
    ['logo', 'dark', 'carup-logo-horizontal-on-dark.svg'],
    ['wordmark', 'light', 'carup-wordmark-on-light.svg'],
    ['wordmark', 'dark', 'carup-wordmark-on-dark.svg'],
    ['stacked', 'dark', 'carup-logo-stacked-on-dark.svg'],
    ['mark', 'dark', 'carup-mark-roofline.svg'],
  ] as [BrandRole, BrandSurface, string][])('%s on %s uses %s', (role, surface, file) => {
    render(<BrandIdentity role={role} surface={surface} height={32} />)
    const image = screen.getByRole('img', { name: 'CarUp' })
    expect(image).toHaveAttribute('data-brand-file', file)
  })

  it('keeps the source aspect ratio: height is set, width follows the viewBox', () => {
    render(<BrandIdentity role="logo" surface="light" height={40} />)
    const image = screen.getByRole('img', { name: 'CarUp' })
    expect(image).toHaveAttribute('height', '40')
    expect(image).toHaveAttribute('width', String(Math.round(40 * 762 / 199)))
  })

  it('is silent to assistive technology when decorative', () => {
    const { container } = render(<BrandIdentity height={24} decorative />)
    expect(screen.queryByRole('img', { name: 'CarUp' })).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})
