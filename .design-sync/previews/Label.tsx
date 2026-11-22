import { Checkbox, Input, Label, Switch } from '@carup/design-system'

export const WithInput = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="model">Model</Label>
    <Input id="model" placeholder="e.g. Hilux" />
  </div>
)

export const RequiredField = () => (
  <div className="grid w-[360px] gap-2">
    <Label htmlFor="plate">
      Zimbabwe number plate <span className="text-destructive">*</span>
    </Label>
    <Input id="plate" className="font-mono" placeholder="e.g. ABC 1234" />
  </div>
)

export const WithControls = () => (
  <div className="grid w-[360px] gap-4">
    <div className="flex items-center gap-2">
      <Checkbox id="dealer-only" defaultChecked />
      <Label htmlFor="dealer-only">Dealer listings only</Label>
    </div>
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor="price-alerts">Price drop alerts</Label>
      <Switch id="price-alerts" defaultChecked />
    </div>
  </div>
)

export const DisabledPeer = () => (
  <div className="grid w-[360px] gap-4">
    <div className="flex items-center gap-2">
      <Checkbox id="home-inspection" disabled />
      <Label htmlFor="home-inspection">Home inspection (not offered in Mutare yet)</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="workshop-inspection" defaultChecked />
      <Label htmlFor="workshop-inspection">Workshop inspection</Label>
    </div>
  </div>
)
