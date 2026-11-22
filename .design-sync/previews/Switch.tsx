import { Badge, Label, Switch } from '@carup/design-system'

export const Default = () => (
  <div className="flex w-[360px] items-center justify-between gap-3">
    <Label htmlFor="saved-search-alerts">Alert me when new matches are listed</Label>
    <Switch id="saved-search-alerts" defaultChecked />
  </div>
)

export const States = () => (
  <div className="grid w-[360px] gap-4">
    <div className="flex items-center gap-3">
      <Switch id="s-on" defaultChecked />
      <Label htmlFor="s-on">On</Label>
    </div>
    <div className="flex items-center gap-3">
      <Switch id="s-off" />
      <Label htmlFor="s-off">Off</Label>
    </div>
    <div className="flex items-center gap-3">
      <Switch id="s-dis-on" defaultChecked disabled />
      <Label htmlFor="s-dis-on">On, disabled</Label>
    </div>
    <div className="flex items-center gap-3">
      <Switch id="s-dis-off" disabled />
      <Label htmlFor="s-dis-off">Off, disabled</Label>
    </div>
  </div>
)

const channels: Array<[string, string, boolean]> = [
  ['transactional_enabled', 'Transactional updates', true],
  ['marketing_enabled', 'Marketing', false],
  ['email_enabled', 'Email', true],
  ['whatsapp_enabled', 'WhatsApp', true],
  ['sms_enabled', 'SMS', false],
]

export const ChannelPreferences = () => (
  <div className="w-[360px] space-y-4 rounded-lg border p-4">
    <p className="text-sm font-semibold">Channels &amp; consent</p>
    {channels.map(([key, label, on]) => (
      <div key={key} className="flex items-center justify-between gap-3">
        <Label htmlFor={key}>{label}</Label>
        <Switch id={key} defaultChecked={on} />
      </div>
    ))}
    <p className="text-xs text-muted-foreground">Transactional and marketing consent are independent.</p>
  </div>
)

export const BillingToggle = () => (
  <div className="flex items-center gap-3">
    <Label htmlFor="billing-annual" className="text-muted-foreground">Monthly</Label>
    <Switch id="billing-annual" defaultChecked aria-label="Bill annually" />
    <Label htmlFor="billing-annual">
      Annual <Badge variant="secondary">Save 20%</Badge>
    </Label>
  </div>
)
