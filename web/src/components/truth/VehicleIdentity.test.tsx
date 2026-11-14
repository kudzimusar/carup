import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VehicleIdentity } from './VehicleIdentity'

const full = {
  title: 'Toyota Hilux 2.8 GD-6 Raider',
  vin: 'AHTGB3CD005123456',
  year: 2021,
  mileageKm: 62400,
  location: 'Harare',
  thumbnailUrl: 'https://example.test/hilux.jpg',
}

describe('VehicleIdentity', () => {
  it('card variant renders all facts and the thumbnail (explicit workspace exposure)', () => {
    render(<VehicleIdentity {...full} variant="card" exposure="workspace" />)
    const root = screen.getByTestId('vehicle-identity')
    expect(root).toHaveAttribute('data-variant', 'card')
    expect(screen.getByText(full.title)).toBeInTheDocument()
    expect(screen.getByTestId('identity-year')).toHaveTextContent('2021')
    expect(screen.getByTestId('identity-mileage')).toHaveTextContent('62,400 km')
    expect(screen.getByTestId('identity-location')).toHaveTextContent('Harare')
    expect(screen.getByTestId('identity-vin')).toHaveTextContent(full.vin)
    expect(screen.getByTestId('identity-thumbnail')).toHaveAttribute('alt', full.title)
  })

  it('row variant is compact and shows the VIN only in explicit workspace exposure', () => {
    render(<VehicleIdentity {...full} variant="row" exposure="workspace" />)
    expect(screen.getByTestId('vehicle-identity')).toHaveAttribute('data-variant', 'row')
    expect(screen.getByText(full.title)).toBeInTheDocument()
    expect(screen.getByTestId('identity-vin')).toHaveTextContent(full.vin)
  })

  it('header variant renders the title as the page heading', () => {
    render(<VehicleIdentity {...full} variant="header" exposure="workspace" />)
    expect(screen.getByRole('heading', { level: 1, name: full.title })).toBeInTheDocument()
  })

  it.each(['card', 'row', 'header'] as const)('%s variant: missing fields are "Not recorded", never fabricated (workspace)', (variant) => {
    render(<VehicleIdentity title="Mazda CX-5" variant={variant} exposure="workspace" />)
    expect(screen.getByTestId('identity-year-missing')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('identity-mileage-missing')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('identity-location-missing')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('identity-vin-missing')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('identity-thumbnail-placeholder')).toHaveTextContent('No image')
    expect(screen.queryByText('0 km')).toBeNull()
    expect(screen.queryByText(/, 20\d\d/)).toBeNull()
  })

  it('uses tabular numerals for mileage', () => {
    render(<VehicleIdentity {...full} variant="row" exposure="workspace" />)
    expect(screen.getByTestId('identity-mileage')).toHaveClass('tabular-nums')
  })

  // R2-02 — PUBLIC-SAFE BY DEFAULT. A bare <VehicleIdentity> (no exposure prop)
  // must never print the raw VIN, even when one is passed. Full identity requires
  // an explicit workspace opt-in; server authorization remains authoritative.
  it.each(['card', 'row', 'header'] as const)(
    'DEFAULT (no exposure prop, %s): the raw VIN can never appear, even when one is passed — negative case',
    (variant) => {
      const { container } = render(<VehicleIdentity {...full} variant={variant} />)
      expect(container.textContent).not.toContain(full.vin)
      expect(screen.queryByText(full.vin)).toBeNull()
      expect(screen.getByTestId('identity-vin-restricted')).toHaveTextContent('Restricted')
    }
  )

  it.each(['card', 'row', 'header'] as const)(
    'DEFAULT (%s): public-safe fields still render normally',
    (variant) => {
      render(<VehicleIdentity {...full} variant={variant} />)
      expect(screen.getByTestId('identity-year')).toHaveTextContent('2021')
      expect(screen.getByTestId('identity-mileage')).toHaveTextContent('62,400 km')
      expect(screen.getByTestId('identity-location')).toHaveTextContent('Harare')
    }
  )

  // R1-03 — explicit public exposure behaves identically to the default.
  it.each(['card', 'row', 'header'] as const)(
    'explicit public exposure (%s): the raw VIN can never appear, even when one is passed — negative case',
    (variant) => {
      const { container } = render(<VehicleIdentity {...full} variant={variant} exposure="public" />)
      expect(container.textContent).not.toContain(full.vin)
      expect(screen.queryByText(full.vin)).toBeNull()
      expect(screen.getByTestId('identity-vin-restricted')).toHaveTextContent('Restricted')
    }
  )

  it('explicit workspace exposure shows the full raw VIN for authorized views', () => {
    render(<VehicleIdentity {...full} variant="card" exposure="workspace" />)
    expect(screen.getByTestId('identity-vin')).toHaveTextContent(full.vin)
    expect(screen.queryByTestId('identity-vin-restricted')).toBeNull()
  })
})
