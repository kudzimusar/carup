import { Label, Slider } from '@carup/design-system'

export const Default = () => (
  <div className="grid w-[360px] gap-3">
    <div className="flex items-center justify-between gap-3">
      <Label>Maximum mileage</Label>
      <span className="text-sm text-muted-foreground tabular-nums">120,000 km</span>
    </div>
    <Slider defaultValue={[120000]} max={300000} step={5000} aria-label="Maximum mileage" />
  </div>
)

export const PriceRange = () => (
  <div className="grid w-[360px] gap-3">
    <div className="flex items-center justify-between gap-3">
      <Label>Price (USD)</Label>
      <span className="text-sm text-muted-foreground tabular-nums">8,000 – 35,000</span>
    </div>
    <Slider defaultValue={[8000, 35000]} max={100000} step={1000} aria-label="Price range" />
  </div>
)

export const YearRange = () => (
  <div className="grid w-[360px] gap-3">
    <div className="flex items-center justify-between gap-3">
      <Label>Year</Label>
      <span className="text-sm text-muted-foreground tabular-nums">2012 – 2020</span>
    </div>
    <Slider defaultValue={[2012, 2020]} min={2000} max={2026} step={1} minStepsBetweenThumbs={1} aria-label="Year range" />
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>2000</span>
      <span>2026</span>
    </div>
  </div>
)

export const Disabled = () => (
  <div className="grid w-[360px] gap-3">
    <div className="flex items-center justify-between gap-3">
      <Label>Search radius from Bulawayo</Label>
      <span className="text-sm text-muted-foreground tabular-nums">50 km</span>
    </div>
    <Slider defaultValue={[50]} max={500} step={10} disabled aria-label="Search radius" />
    <p className="text-sm text-muted-foreground">Turn on location access to search by distance.</p>
  </div>
)
