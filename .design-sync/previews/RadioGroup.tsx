import { Label, RadioGroup, RadioGroupItem } from '@carup/design-system'

export const Default = () => (
  <div className="grid w-[300px] gap-3">
    <p className="text-sm font-semibold">Transmission</p>
    <RadioGroup defaultValue="automatic" aria-label="Transmission">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="any" id="tx-any" />
        <Label htmlFor="tx-any">Any</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="automatic" id="tx-auto" />
        <Label htmlFor="tx-auto">Automatic</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="manual" id="tx-manual" />
        <Label htmlFor="tx-manual">Manual</Label>
      </div>
    </RadioGroup>
  </div>
)

const contactOptions: Array<[string, string, string]> = [
  ['whatsapp', 'WhatsApp', 'Fastest reply from most Harare dealers.'],
  ['call', 'Phone call', 'The seller calls you back during business hours.'],
  ['email', 'Email', 'Best for detailed questions and documents.'],
]

export const WithDescriptions = () => (
  <div className="grid w-[400px] gap-3">
    <p className="text-sm font-semibold">How should the seller contact you?</p>
    <RadioGroup defaultValue="whatsapp" aria-label="Contact preference">
      {contactOptions.map(([value, label, help]) => (
        <div key={value} className="flex items-start gap-3">
          <RadioGroupItem value={value} id={`contact-${value}`} />
          <div className="grid gap-1.5">
            <Label htmlFor={`contact-${value}`}>{label}</Label>
            <p className="text-sm text-muted-foreground">{help}</p>
          </div>
        </div>
      ))}
    </RadioGroup>
  </div>
)

export const Horizontal = () => (
  <div className="grid gap-3">
    <p className="text-sm font-semibold">Condition</p>
    <RadioGroup defaultValue="used" orientation="horizontal" className="flex gap-6" aria-label="Condition">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="new" id="cond-new" />
        <Label htmlFor="cond-new">New</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="ex-japan" id="cond-exjapan" />
        <Label htmlFor="cond-exjapan">Ex-Japan</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="used" id="cond-used" />
        <Label htmlFor="cond-used">Locally used</Label>
      </div>
    </RadioGroup>
  </div>
)

export const DisabledOption = () => (
  <div className="grid w-[360px] gap-3">
    <p className="text-sm font-semibold">Inspection location</p>
    <RadioGroup defaultValue="workshop" aria-label="Inspection location">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="workshop" id="loc-workshop" />
        <Label htmlFor="loc-workshop">Partner workshop, Msasa</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="seller" id="loc-seller" />
        <Label htmlFor="loc-seller">At the seller's address</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="home" id="loc-home" disabled />
        <Label htmlFor="loc-home" className="opacity-50">Mobile inspector (not yet in Mutare)</Label>
      </div>
    </RadioGroup>
  </div>
)
