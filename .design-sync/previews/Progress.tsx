import { Progress } from '@carup/design-system'

export const ListingUpload = () => (
  <div className="w-[360px] space-y-2">
    <div className="flex justify-between text-sm">
      <span className="font-medium">Uploading photos</span>
      <span className="text-muted-foreground">7 of 12</span>
    </div>
    <Progress value={58} aria-label="Photo upload progress" />
    <p className="text-xs text-muted-foreground">Keep this page open until all photos are uploaded.</p>
  </div>
)

export const ListingQuality = () => (
  <div className="w-[360px] space-y-1">
    <div className="flex justify-between">
      <span className="text-xs text-muted-foreground">Advertisement strength</span>
      <span className="text-xs font-semibold">72%</span>
    </div>
    <Progress value={72} className="h-2" aria-label="Advertisement strength" />
  </div>
)

export const Values = () => (
  <div className="w-[360px] space-y-4 text-sm">
    {[
      { label: 'Vehicle details', value: 100 },
      { label: 'Photos', value: 50 },
      { label: 'Service history', value: 25 },
      { label: 'Ownership documents', value: 0 },
    ].map((step) => (
      <div key={step.label} className="space-y-1">
        <div className="flex justify-between">
          <span>{step.label}</span>
          <span className="text-muted-foreground">{step.value}%</span>
        </div>
        <Progress value={step.value} aria-label={step.label} />
      </div>
    ))}
  </div>
)

export const Thin = () => (
  <div className="w-[360px] space-y-1">
    <p className="text-sm font-medium">Garage profile complete</p>
    <Progress value={85} className="h-1.5" aria-label="Garage profile completeness" />
  </div>
)
