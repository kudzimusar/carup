import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@carup/design-system'

// The open listbox turns on Radix scroll-lock, which zeroes the page's body padding; the inner
// gutter keeps the story off the card edge in that state.
export const Open = () => (
  <div className="grid w-64 gap-2" style={{ margin: 24 }}>
    <Label htmlFor="make-select">Make</Label>
    <Select defaultValue="toyota" defaultOpen>
      <SelectTrigger id="make-select" className="w-full">
        <SelectValue placeholder="Any make" />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          <SelectLabel>Popular in Zimbabwe</SelectLabel>
          <SelectItem value="toyota">Toyota</SelectItem>
          <SelectItem value="honda">Honda</SelectItem>
          <SelectItem value="nissan">Nissan</SelectItem>
          <SelectItem value="mazda">Mazda</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other makes</SelectLabel>
          <SelectItem value="isuzu">Isuzu</SelectItem>
          <SelectItem value="mercedes-benz">Mercedes-Benz</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
)

export const SellFormFields = () => (
  <div className="grid w-[400px] grid-cols-2 gap-4">
    <div className="grid gap-2">
      <Label>Year</Label>
      <Select defaultValue="2019">
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {['2021', '2020', '2019', '2018', '2017'].map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="grid gap-2">
      <Label>Body style</Label>
      <Select defaultValue="Double cab">
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {['Hatchback', 'Sedan', 'SUV', 'Double cab', 'Single cab'].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="grid gap-2">
      <Label>Fuel type</Label>
      <Select defaultValue="Diesel">
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {['Petrol', 'Diesel', 'Hybrid', 'Electric'].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="grid gap-2">
      <Label>Transmission</Label>
      <Select>
        <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {['Automatic', 'Manual'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>
)

export const WithHelperText = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="registration-stage">Zimbabwe registration stage</Label>
    <Select>
      <SelectTrigger id="registration-stage" className="w-full">
        <SelectValue placeholder="Choose the vehicle's current stage" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="import_in_transit">Import in transit</SelectItem>
        <SelectItem value="customs_cleared_cvr_pending">Customs cleared — local registration pending</SelectItem>
        <SelectItem value="locally_registered">Locally registered in Zimbabwe</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-sm text-muted-foreground">
      A permanent import can be listed while local registration is still progressing.
    </p>
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-3">
    <Select defaultValue="newest">
      <SelectTrigger size="sm" aria-label="Sort listings"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="newest">Newest first</SelectItem>
        <SelectItem value="price-asc">Price: low to high</SelectItem>
      </SelectContent>
    </Select>
    <Select defaultValue="harare">
      <SelectTrigger aria-label="City"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="harare">Harare</SelectItem>
        <SelectItem value="bulawayo">Bulawayo</SelectItem>
        <SelectItem value="mutare">Mutare</SelectItem>
      </SelectContent>
    </Select>
  </div>
)

export const Invalid = () => (
  <div className="grid w-64 gap-2">
    <Label htmlFor="condition-select">Condition</Label>
    <Select>
      <SelectTrigger id="condition-select" className="w-full" aria-invalid aria-describedby="condition-error">
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="excellent">Excellent</SelectItem>
        <SelectItem value="good">Good</SelectItem>
        <SelectItem value="fair">Fair</SelectItem>
      </SelectContent>
    </Select>
    <p id="condition-error" className="text-sm text-destructive">Choose the vehicle's condition.</p>
  </div>
)

export const Disabled = () => (
  <div className="grid w-64 gap-2">
    <Label htmlFor="fuel-locked">Fuel type</Label>
    <Select defaultValue="diesel" disabled>
      <SelectTrigger id="fuel-locked" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="petrol">Petrol</SelectItem>
        <SelectItem value="diesel">Diesel</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-sm text-muted-foreground">Set from the vehicle passport.</p>
  </div>
)
