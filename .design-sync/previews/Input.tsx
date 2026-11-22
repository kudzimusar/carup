import { Input, Label } from '@carup/design-system'

export const Default = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="listing-search">Search the marketplace</Label>
    <Input id="listing-search" type="search" placeholder="Make, model or keyword, e.g. Hilux" />
  </div>
)

export const Types = () => (
  <div className="grid w-[360px] gap-4">
    <div className="grid gap-2">
      <Label htmlFor="mileage">Mileage (km)</Label>
      <Input id="mileage" type="number" inputMode="numeric" defaultValue={62400} />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="enquiry-email">Email</Label>
      <Input id="enquiry-email" type="email" defaultValue="tendai@example.com" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="enquiry-phone">WhatsApp number</Label>
      <Input id="enquiry-phone" type="tel" placeholder="+263 77 123 4567" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="logbook">Registration book (photo or PDF)</Label>
      <Input id="logbook" type="file" />
    </div>
  </div>
)

export const WithHelperText = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="engine-number">Engine number</Label>
    <Input id="engine-number" className="font-mono" defaultValue="1GD-789012" />
    <p className="text-sm text-muted-foreground">Required to publish your listing.</p>
  </div>
)

export const Invalid = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="asking-price">Asking price (USD)</Label>
    <Input id="asking-price" type="number" defaultValue={0} aria-invalid aria-describedby="asking-price-error" />
    <p id="asking-price-error" className="text-sm text-destructive">Enter an asking price above $500.</p>
  </div>
)

export const Disabled = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="vin">VIN / chassis number</Label>
    <Input id="vin" className="font-mono" defaultValue="AHTKB8CD702145871" disabled />
    <p className="text-sm text-muted-foreground">Locked after the vehicle passport was issued.</p>
  </div>
)

export const PriceRange = () => (
  <div className="grid w-[360px] gap-2">
    <Label>Price range (USD)</Label>
    <div className="grid grid-cols-2 gap-3">
      <Input type="number" inputMode="numeric" placeholder="No min" aria-label="Minimum price" defaultValue={8000} />
      <Input type="number" inputMode="numeric" placeholder="No max" aria-label="Maximum price" />
    </div>
  </div>
)
