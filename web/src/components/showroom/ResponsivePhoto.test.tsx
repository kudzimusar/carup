import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ResponsivePhoto } from './ResponsivePhoto'

const ORIGIN = 'https://abcd1234.supabase.co'
const PUBLISHED = `${ORIGIN}/storage/v1/object/public/vehicle-images/v1/VIN/00-front.png`

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('ResponsivePhoto', () => {
  it('serves the published original, unchanged, when renditions are not configured (the default)', () => {
    render(<ResponsivePhoto src={PUBLISHED} alt="2019 Toyota Hilux" sizes="100vw" />)
    const img = screen.getByRole('img', { name: '2019 Toyota Hilux' })
    expect(img).toHaveAttribute('src', PUBLISHED)
    expect(img).not.toHaveAttribute('srcset')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('data-photo-delivery', 'original')
  })

  it('serves sized renditions on a configured origin, then falls back to the original, then reports unavailable', () => {
    vi.stubEnv('VITE_CARUP_MEDIA_RENDER_ORIGINS', ORIGIN)
    const onUnavailable = vi.fn()
    render(<ResponsivePhoto src={PUBLISHED} alt="2019 Toyota Hilux" sizes="(min-width: 1024px) 58vw, 100vw" onUnavailable={onUnavailable} />)
    const img = screen.getByRole('img', { name: '2019 Toyota Hilux' })
    expect(img).toHaveAttribute('data-photo-delivery', 'rendition')
    expect(img.getAttribute('src')).toContain('/storage/v1/render/image/public/vehicle-images/v1/VIN/00-front.png?width=960')
    expect(img.getAttribute('srcset')).toContain('?width=320&quality=72 320w')
    expect(img).toHaveAttribute('sizes', '(min-width: 1024px) 58vw, 100vw')

    fireEvent.error(img)
    expect(img).toHaveAttribute('data-photo-delivery', 'original')
    expect(img).toHaveAttribute('src', PUBLISHED)
    expect(img).not.toHaveAttribute('srcset')
    expect(onUnavailable).not.toHaveBeenCalled()

    fireEvent.error(img)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('a new photo starts again from its rendition after a previous photo failed', () => {
    vi.stubEnv('VITE_CARUP_MEDIA_RENDER_ORIGINS', ORIGIN)
    const { rerender } = render(<ResponsivePhoto src={PUBLISHED} alt="photo" sizes="100vw" />)
    fireEvent.error(screen.getByRole('img', { name: 'photo' }))
    expect(screen.getByRole('img', { name: 'photo' })).toHaveAttribute('data-photo-delivery', 'original')
    rerender(<ResponsivePhoto src={PUBLISHED.replace('00-front', '01-rear')} alt="photo" sizes="100vw" />)
    expect(screen.getByRole('img', { name: 'photo' })).toHaveAttribute('data-photo-delivery', 'rendition')
  })

  it('loads the likely largest paint eagerly with high priority; everything else lazily', () => {
    render(<ResponsivePhoto src={PUBLISHED} alt="hero" sizes="100vw" priority />)
    const img = screen.getByRole('img', { name: 'hero' })
    expect(img).toHaveAttribute('loading', 'eager')
    expect(img).toHaveAttribute('fetchpriority', 'high')
  })
})
