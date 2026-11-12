import { cn } from '@/lib/utils'

/**
 * RX-02A S1-3 — VehicleIdentity (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.1).
 * One vehicle presentation across Marketplace card, saved, Seller preview and garage.
 * Variants: card | row | header.
 * Missing fields render an explicit "Not recorded" placeholder — never fabricated.
 */
export interface VehicleIdentityProps {
  /** Display title, e.g. "Toyota Hilux 2.8 GD-6 Raider". */
  title: string
  variant?: 'card' | 'row' | 'header'
  vin?: string | null
  year?: number | null
  mileageKm?: number | null
  location?: string | null
  thumbnailUrl?: string | null
  /** Accessible label for the thumbnail; alt text when the image renders. */
  thumbnailAlt?: string
  className?: string
}

function Missing({ testId }: { testId?: string }) {
  return (
    <span data-testid={testId} className="italic text-carup-text-3">
      Not recorded
    </span>
  )
}

export function VehicleIdentity({
  title,
  variant = 'card',
  vin = null,
  year = null,
  mileageKm = null,
  location = null,
  thumbnailUrl = null,
  thumbnailAlt,
  className,
}: VehicleIdentityProps) {
  const facts: Array<{ label: string; node: React.ReactNode; testId?: string }> = [
    { label: 'Year', node: year != null ? year : <Missing testId="identity-year-missing" />, testId: 'identity-year' },
    {
      label: 'Mileage',
      node:
        mileageKm != null ? (
          <span data-testid="identity-mileage" className="tabular-nums">
            {mileageKm.toLocaleString('en-US')} km
          </span>
        ) : (
          <Missing testId="identity-mileage-missing" />
        ),
    },
    { label: 'Location', node: location ? location : <Missing testId="identity-location-missing" />, testId: 'identity-location' },
    { label: 'VIN', node: vin ? <span className="font-mono text-[12px]">{vin}</span> : <Missing testId="identity-vin-missing" />, testId: 'identity-vin' },
  ]

  const thumb = thumbnailUrl ? (
    <img
      src={thumbnailUrl}
      alt={thumbnailAlt ?? title}
      data-testid="identity-thumbnail"
      className={cn(
        'shrink-0 rounded-[6px] border border-carup-line object-cover',
        variant === 'header' ? 'h-16 w-24' : 'h-14 w-20'
      )}
    />
  ) : (
    <div
      data-testid="identity-thumbnail-placeholder"
      aria-label="No image recorded"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[6px] border border-dashed border-carup-line-strong bg-carup-bg-surface text-[10.5px] text-carup-text-3',
        variant === 'header' ? 'h-16 w-24' : 'h-14 w-20'
      )}
    >
      No image
    </div>
  )

  if (variant === 'header') {
    return (
      <div data-testid="vehicle-identity" data-variant="header" className={cn('flex items-center gap-4', className)}>
        {thumb}
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-[1.2] tracking-[-0.02em] text-carup-text">{title}</h1>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-carup-text-2">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1">
                <dt className="text-carup-text-3">{f.label}:</dt>
                <dd data-testid={f.testId}>{f.node}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    )
  }

  if (variant === 'row') {
    return (
      <div
        data-testid="vehicle-identity"
        data-variant="row"
        className={cn('flex items-center gap-3 border-b border-carup-line py-3', className)}
      >
        {thumb}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-carup-text">{title}</p>
          <p className="text-[12px] text-carup-text-2">
            {facts.slice(0, 3).map((f, i) => (
              <span key={f.label}>
                {i > 0 && <span className="mx-1 text-carup-line-strong">·</span>}
                <span data-testid={f.testId}>{f.node}</span>
              </span>
            ))}
          </p>
        </div>
        <span data-testid="identity-vin" className="hidden font-mono text-[11px] text-carup-text-3 sm:block">
          {vin ?? <Missing testId="identity-vin-missing" />}
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="vehicle-identity"
      data-variant="card"
      className={cn('overflow-hidden rounded-[12px] border border-carup-line bg-carup-bg-raised', className)}
    >
      <div className={cn('border-b border-carup-line', thumbnailUrl ? '' : 'p-3')}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={thumbnailAlt ?? title} data-testid="identity-thumbnail" className="h-36 w-full object-cover" />
        ) : (
          thumb
        )}
      </div>
      <div className="p-3">
        <p className="text-[14px] font-semibold leading-snug text-carup-text">{title}</p>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-carup-text-2">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline gap-1">
              <dt className="text-carup-text-3">{f.label}</dt>
              <dd data-testid={f.testId} className="min-w-0 truncate">
                {f.node}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
