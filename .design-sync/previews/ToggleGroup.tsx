import { ToggleGroup, ToggleGroupItem } from '@carup/design-system'
import { LayoutGrid, List, Map } from 'lucide-react'

export const ResultsView = () => (
  <ToggleGroup type="single" variant="outline" defaultValue="grid" aria-label="Results layout">
    <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid /></ToggleGroupItem>
    <ToggleGroupItem value="list" aria-label="List view"><List /></ToggleGroupItem>
    <ToggleGroupItem value="map" aria-label="Map view"><Map /></ToggleGroupItem>
  </ToggleGroup>
)

export const FuelFilter = () => (
  <ToggleGroup type="multiple" variant="outline" defaultValue={['diesel', 'hybrid']} aria-label="Fuel type">
    <ToggleGroupItem value="petrol">Petrol</ToggleGroupItem>
    <ToggleGroupItem value="diesel">Diesel</ToggleGroupItem>
    <ToggleGroupItem value="hybrid">Hybrid</ToggleGroupItem>
    <ToggleGroupItem value="electric">Electric</ToggleGroupItem>
  </ToggleGroup>
)

export const Transmission = () => (
  <ToggleGroup type="single" defaultValue="any" aria-label="Transmission">
    <ToggleGroupItem value="any">Any</ToggleGroupItem>
    <ToggleGroupItem value="automatic">Automatic</ToggleGroupItem>
    <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
  </ToggleGroup>
)

export const Sizes = () => (
  <div className="flex flex-col items-start gap-3">
    <ToggleGroup type="single" variant="outline" size="sm" defaultValue="usd" aria-label="Currency (small)">
      <ToggleGroupItem value="usd">USD</ToggleGroupItem>
      <ToggleGroupItem value="zig">ZiG</ToggleGroupItem>
    </ToggleGroup>
    <ToggleGroup type="single" variant="outline" defaultValue="usd" aria-label="Currency">
      <ToggleGroupItem value="usd">USD</ToggleGroupItem>
      <ToggleGroupItem value="zig">ZiG</ToggleGroupItem>
    </ToggleGroup>
    <ToggleGroup type="single" variant="outline" size="lg" defaultValue="usd" aria-label="Currency (large)">
      <ToggleGroupItem value="usd">USD</ToggleGroupItem>
      <ToggleGroupItem value="zig">ZiG</ToggleGroupItem>
    </ToggleGroup>
  </div>
)
