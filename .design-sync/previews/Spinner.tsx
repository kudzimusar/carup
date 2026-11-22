import { Button, Spinner } from '@carup/design-system'

export const Sizes = () => (
  <div className="flex items-center gap-6">
    <Spinner />
    <Spinner className="size-6" />
    <Spinner className="size-8" />
  </div>
)

export const InButton = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled><Spinner /> Sending enquiry</Button>
    <Button variant="outline" disabled><Spinner /> Saving</Button>
  </div>
)

export const InlineStatus = () => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Spinner className="text-primary" />
    Checking ZIMRA duty signals for AFE 1234…
  </div>
)

export const SectionLoading = () => (
  <div style={{ height: 140 }} className="flex w-[340px] flex-col items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground">
    <Spinner className="size-6 text-primary" />
    Loading service history
  </div>
)
