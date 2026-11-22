import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
} from '@carup/design-system'
import { ArrowUp, Copy, Search, X } from 'lucide-react'

export const SearchWithIcon = () => (
  <InputGroup className="w-[400px]">
    <InputGroupInput placeholder="Search make, model or dealer" aria-label="Search listings" defaultValue="Toyota Hilux" />
    <InputGroupAddon>
      <Search />
    </InputGroupAddon>
    <InputGroupAddon align="inline-end">
      <InputGroupText>24 results</InputGroupText>
      <InputGroupButton size="icon-xs" aria-label="Clear search"><X /></InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
)

export const PrefixAndSuffix = () => (
  <div className="grid w-[360px] gap-4">
    <div className="grid gap-2">
      <Label htmlFor="ig-price">Asking price</Label>
      <InputGroup>
        <InputGroupAddon><InputGroupText>$</InputGroupText></InputGroupAddon>
        <InputGroupInput id="ig-price" inputMode="numeric" defaultValue="38,500" />
        <InputGroupAddon align="inline-end"><InputGroupText>USD</InputGroupText></InputGroupAddon>
      </InputGroup>
    </div>
    <div className="grid gap-2">
      <Label htmlFor="ig-mileage">Mileage</Label>
      <InputGroup>
        <InputGroupInput id="ig-mileage" inputMode="numeric" defaultValue="62,400" />
        <InputGroupAddon align="inline-end"><InputGroupText>km</InputGroupText></InputGroupAddon>
      </InputGroup>
    </div>
    <div className="grid gap-2">
      <Label htmlFor="ig-phone">WhatsApp number</Label>
      <InputGroup>
        <InputGroupAddon><InputGroupText>+263</InputGroupText></InputGroupAddon>
        <InputGroupInput id="ig-phone" type="tel" placeholder="77 123 4567" />
      </InputGroup>
    </div>
  </div>
)

export const WithButton = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="ig-referral">Your referral link</Label>
    <InputGroup>
      <InputGroupInput id="ig-referral" readOnly defaultValue="carup.dev/r/tendai-m42" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="sm" variant="secondary"><Copy /> Copy</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
)

export const MessageComposer = () => (
  <InputGroup className="w-[400px]">
    <InputGroupTextarea
      rows={3}
      aria-label="Message to dealer"
      defaultValue="Hi, is the Honda Fit still available? Can I view it in Bulawayo on Saturday morning?"
    />
    <InputGroupAddon align="block-end">
      <InputGroupText>82/500</InputGroupText>
      <InputGroupButton size="icon-xs" variant="default" className="ml-auto rounded-full" aria-label="Send message">
        <ArrowUp />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
)

export const Invalid = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="ig-vin">VIN / chassis number</Label>
    <InputGroup>
      <InputGroupInput id="ig-vin" className="font-mono" defaultValue="AHTKB8CD7021" aria-invalid aria-describedby="ig-vin-error" />
      <InputGroupAddon align="inline-end"><InputGroupText>12/17</InputGroupText></InputGroupAddon>
    </InputGroup>
    <p id="ig-vin-error" className="text-sm text-destructive">A VIN has 17 characters.</p>
  </div>
)

export const Disabled = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="ig-zig">Asking price (ZiG)</Label>
    <InputGroup data-disabled="true">
      <InputGroupAddon><InputGroupText>ZiG</InputGroupText></InputGroupAddon>
      <InputGroupInput id="ig-zig" disabled placeholder="Set by the USD price" />
    </InputGroup>
  </div>
)
