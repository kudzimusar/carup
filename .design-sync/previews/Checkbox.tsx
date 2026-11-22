import { Checkbox, Label } from '@carup/design-system'

export const Default = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="terms" defaultChecked />
    <Label htmlFor="terms">I confirm I am the registered owner of this vehicle</Label>
  </div>
)

export const States = () => (
  <div className="grid w-[360px] gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="c-unchecked" />
      <Label htmlFor="c-unchecked">Unchecked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="c-checked" defaultChecked />
      <Label htmlFor="c-checked">Checked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="c-disabled" disabled />
      <Label htmlFor="c-disabled">Disabled</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="c-disabled-checked" disabled defaultChecked />
      <Label htmlFor="c-disabled-checked">Disabled, checked</Label>
    </div>
  </div>
)

export const WithDescription = () => (
  <div className="flex w-[400px] items-start gap-3">
    <Checkbox id="share-history" defaultChecked />
    <div className="grid gap-1.5">
      <Label htmlFor="share-history">Share service history with buyers</Label>
      <p className="text-sm text-muted-foreground">
        Buyers who enquire can see the service records you uploaded. You can stop sharing at any time.
      </p>
    </div>
  </div>
)

const features: Array<[string, string, boolean]> = [
  ['ac', 'Air conditioning', true],
  ['reverse-camera', 'Reverse camera', true],
  ['four-wd', '4x4 / 4WD', false],
  ['leather', 'Leather seats', false],
  ['towbar', 'Towbar', true],
]

export const FilterGroup = () => (
  <div className="w-[300px] space-y-3">
    <p className="text-sm font-semibold">Features</p>
    {features.map(([id, label, on]) => (
      <div key={id} className="flex items-center gap-2">
        <Checkbox id={id} defaultChecked={on} />
        <Label htmlFor={id}>{label}</Label>
      </div>
    ))}
  </div>
)

export const Invalid = () => (
  <div className="grid w-[400px] gap-2">
    <div className="flex items-center gap-2">
      <Checkbox id="seller-terms" aria-invalid aria-describedby="seller-terms-error" />
      <Label htmlFor="seller-terms">I accept the CarUp seller terms</Label>
    </div>
    <p id="seller-terms-error" className="text-sm text-destructive">Accept the seller terms to publish your listing.</p>
  </div>
)
