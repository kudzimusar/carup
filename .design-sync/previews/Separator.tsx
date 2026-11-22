import { Separator } from '@carup/design-system'

export const Horizontal = () => (
  <div className="w-[340px]">
    <div className="space-y-1">
      <h4 className="text-sm font-medium leading-none">Toyota Hilux 2.8 GD-6 Raider</h4>
      <p className="text-sm text-muted-foreground">Listed by Harare Auto Hub · dealer</p>
    </div>
    <Separator className="my-4" />
    <dl className="grid grid-cols-2 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Odometer</dt>
      <dd className="text-right font-medium">62,400 km</dd>
      <dt className="text-muted-foreground">Transmission</dt>
      <dd className="text-right font-medium">Automatic</dd>
    </dl>
  </div>
)

export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-sm">
    <span>2021</span>
    <Separator orientation="vertical" />
    <span>62,400 km</span>
    <Separator orientation="vertical" />
    <span>Diesel</span>
    <Separator orientation="vertical" />
    <span>Harare</span>
  </div>
)

export const InFooterLinks = () => (
  <div className="w-[340px] space-y-3 text-sm">
    <p className="font-medium">CarUp Zimbabwe</p>
    <Separator />
    <div className="flex h-4 items-center gap-3 text-muted-foreground">
      <span>Privacy</span>
      <Separator orientation="vertical" />
      <span>Terms</span>
      <Separator orientation="vertical" />
      <span>Help centre</span>
    </div>
  </div>
)
