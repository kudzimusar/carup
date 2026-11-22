import { Label, Textarea } from '@carup/design-system'

export const Default = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="enquiry-message">Message to the seller</Label>
    <Textarea
      id="enquiry-message"
      rows={4}
      placeholder="Hi, is the Hilux still available? I'd like to arrange a viewing in Harare this weekend."
    />
  </div>
)

export const WithHelperText = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="vehicle-description">Vehicle description</Label>
    <Textarea
      id="vehicle-description"
      rows={5}
      defaultValue="Single owner since new, full Toyota service history at Croco Motors. New tyres fitted in August, towbar and canopy included. Never used for commercial work."
    />
    <p className="text-sm text-muted-foreground">Describe condition and extras. Do not include phone numbers; buyers contact you through CarUp.</p>
  </div>
)

export const Invalid = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="report-reason">Why are you reporting this listing?</Label>
    <Textarea id="report-reason" rows={3} aria-invalid aria-describedby="report-reason-error" />
    <p id="report-reason-error" className="text-sm text-destructive">Tell us what looks wrong so the Trust &amp; Safety team can review it.</p>
  </div>
)

export const Disabled = () => (
  <div className="grid w-[400px] gap-2">
    <Label htmlFor="inspection-notes">Inspector notes</Label>
    <Textarea
      id="inspection-notes"
      rows={3}
      disabled
      defaultValue="Minor stone chips on bonnet. Rear brake pads at 30%. No signs of accident repair."
    />
    <p className="text-sm text-muted-foreground">Locked once the inspection report is published.</p>
  </div>
)
