import { describe, expect, it } from 'vitest'
import { parseRenderOrigins, photoSourcesFor, photoSources, RENDITION_WIDTHS } from './mediaDelivery'

const ORIGIN = 'https://abcd1234.supabase.co'
const origins = parseRenderOrigins(ORIGIN)
const published = `${ORIGIN}/storage/v1/object/public/vehicle-images/marketplace-reference-synthetic/v1/VIN123/00-front.png`

describe('photoSourcesFor — governed renditions', () => {
  it('derives width-described renditions for a published listing photo on an allow-listed origin', () => {
    const sources = photoSourcesFor(published, origins)
    expect(sources.original).toBe(published)
    expect(sources.src).toBe(`${ORIGIN}/storage/v1/render/image/public/vehicle-images/marketplace-reference-synthetic/v1/VIN123/00-front.png?width=960&quality=72`)
    const candidates = sources.srcSet?.split(', ') ?? []
    expect(candidates).toHaveLength(RENDITION_WIDTHS.length)
    expect(candidates[0]).toMatch(/\/render\/image\/public\/vehicle-images\/.*\?width=320&quality=72 320w$/)
    expect(candidates.at(-1)).toMatch(/\?width=1600&quality=72 1600w$/)
  })

  it('leaves everything outside the boundary untouched', () => {
    const cases = [
      '',
      'not a url',
      'data:image/png;base64,AAAA',
      'blob:https://carup.example/123',
      'https://evil.example/storage/v1/object/public/vehicle-images/x.png',
      `${ORIGIN}/storage/v1/object/public/vehicle-evidence/x.png`,
      `${ORIGIN}/storage/v1/object/sign/vehicle-images/x.png?token=abc`,
      `${ORIGIN}/storage/v1/object/public/vehicle-images/x.png?download=1`,
      `${ORIGIN}/storage/v1/render/image/public/vehicle-images/x.png?width=10`,
      `http://abcd1234.supabase.co/storage/v1/object/public/vehicle-images/x.png`,
    ]
    for (const url of cases) {
      const sources = photoSourcesFor(url, origins)
      expect(sources, url).toEqual({ src: url, original: url })
    }
  })

  it('is off when no origin is configured for the build (the default)', () => {
    expect(photoSourcesFor(published, new Set())).toEqual({ src: published, original: published })
    expect(photoSources(published)).toEqual({ src: published, original: published })
  })

  it('accepts only https origins, plus loopback for local stacks', () => {
    expect([...parseRenderOrigins('https://a.supabase.co, http://b.example, http://127.0.0.1:54741, junk')]).toEqual([
      'https://a.supabase.co',
      'http://127.0.0.1:54741',
    ])
  })
})
