import {
  Button,
  Input,
  Label,
  MoneyDisplay,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@carup/design-system'
import { Bell, Gauge, Info } from 'lucide-react'

const noAutoFocus = (e: Event) => e.preventDefault()

export const PriceAlert = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="outline"><Bell /> Price alert</Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80" onOpenAutoFocus={noAutoFocus}>
      <div className="grid gap-4">
        <div className="space-y-1">
          <h4 className="text-sm font-medium leading-none">Alert me on a price drop</h4>
          <p className="text-sm text-muted-foreground">Mazda CX-5 2.2D Akera · 2019 · Harare</p>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">Currently</span>
          <MoneyDisplay amount={24500} currency="USD" source="asking" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="alert-below" className="text-xs">Notify me below (USD)</Label>
          <Input id="alert-below" defaultValue="22,000" />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="alert-whatsapp" className="font-normal">Also send on WhatsApp</Label>
          <Switch id="alert-whatsapp" defaultChecked />
        </div>
        <Button size="sm">Set alert</Button>
      </div>
    </PopoverContent>
  </Popover>
)

export const PriceGuideInfo = () => (
  <div className="flex items-center gap-2">
    <MoneyDisplay amount={21800} currency="USD" source="guide" />
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="About guide prices"><Info /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" onOpenAutoFocus={noAutoFocus}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium leading-none">About guide prices</h4>
          <p className="text-sm text-muted-foreground">
            A guide price is an estimate from recent CarUp sales of similar vehicles in Zimbabwe. It is not a
            valuation of this vehicle and the seller's asking price may differ.
          </p>
          <Button variant="link" size="sm" className="h-auto px-0">How guide prices work</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
)

export const RangeFilter = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="outline"><Gauge /> Mileage</Button>
    </PopoverTrigger>
    <PopoverContent align="start" onOpenAutoFocus={noAutoFocus}>
      <div className="grid gap-4">
        <h4 className="text-sm font-medium leading-none">Mileage (km)</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="km-min" className="text-xs">From</Label>
            <Input id="km-min" placeholder="0" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="km-max" className="text-xs">To</Label>
            <Input id="km-max" defaultValue="100,000" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm">Reset</Button>
          <Button size="sm">Apply</Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
)
