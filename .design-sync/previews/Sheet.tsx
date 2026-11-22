import {
  Badge,
  Button,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Slider,
  Switch,
} from '@carup/design-system'
import { Bell, CalendarCheck, MessageSquare, SlidersHorizontal, TrendingDown } from 'lucide-react'

const noAutoFocus = (e: Event) => e.preventDefault()

const MarketplaceBar = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3">
    <div>
      <div className="text-sm font-semibold">Marketplace</div>
      <div className="text-xs text-muted-foreground">248 published vehicles · Harare</div>
    </div>
    {children}
  </div>
)

const bodyTypes = [
  { id: 'suv', label: 'SUV', checked: true },
  { id: 'pickup', label: 'Pickup', checked: true },
  { id: 'sedan', label: 'Sedan', checked: false },
  { id: 'hatch', label: 'Hatchback', checked: false },
]

export const MobileFilters = () => (
  <Sheet defaultOpen>
    <MarketplaceBar>
      <SheetTrigger asChild>
        <Button><SlidersHorizontal /> All filters <Badge variant="secondary">3</Badge></Button>
      </SheetTrigger>
    </MarketplaceBar>
    <SheetContent side="left" onOpenAutoFocus={noAutoFocus}>
      <SheetHeader className="border-b">
        <SheetTitle>Build your shortlist</SheetTitle>
        <SheetDescription>Refine the published inventory. Seller-stated facts keep their evidence states.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-6 px-4">
        <div className="grid gap-2">
          <Label>Make</Label>
          <Select defaultValue="toyota">
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="toyota">Toyota</SelectItem>
              <SelectItem value="honda">Honda</SelectItem>
              <SelectItem value="nissan">Nissan</SelectItem>
              <SelectItem value="mazda">Mazda</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label>Asking price (USD)</Label>
            <span className="text-xs text-muted-foreground">$8,000 – $40,000</span>
          </div>
          <Slider defaultValue={[8000, 40000]} min={0} max={80000} step={500} />
        </div>
        <div className="grid gap-3">
          <Label>Body type</Label>
          <div className="grid grid-cols-2 gap-3">
            {bodyTypes.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <Checkbox id={`body-${t.id}`} defaultChecked={t.checked} />
                <Label htmlFor={`body-${t.id}`} className="font-normal">{t.label}</Label>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="dealer-only" className="font-normal">Dealer listings only</Label>
          <Switch id="dealer-only" />
        </div>
      </div>
      <SheetFooter className="flex-row border-t">
        <Button variant="ghost" className="flex-1">Clear all</Button>
        <SheetClose asChild>
          <Button className="flex-1">Show 18 listings</Button>
        </SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
)

const notifications = [
  { icon: MessageSquare, title: 'New enquiry on Toyota Hilux 2.8 GD-6', meta: 'Rudo C. · 12 min ago', unread: true },
  { icon: TrendingDown, title: 'Price drop on a saved Mazda CX-5', meta: 'Saved search · 1 h ago', unread: true },
  { icon: CalendarCheck, title: 'Inspection booked for Thu 20 Nov', meta: 'Honda Fit 1.5 Hybrid · Bulawayo', unread: false },
]

export const NotificationsPanel = () => (
  <Sheet defaultOpen>
    <MarketplaceBar>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Notifications"><Bell /></Button>
      </SheetTrigger>
    </MarketplaceBar>
    <SheetContent side="right" onOpenAutoFocus={noAutoFocus}>
      <SheetHeader>
        <SheetTitle>Notifications</SheetTitle>
        <SheetDescription>2 unread</SheetDescription>
      </SheetHeader>
      <div className="grid gap-1 px-2">
        {notifications.map(({ icon: Icon, title, meta, unread }) => (
          <div key={title} className="flex items-start gap-3 rounded-md p-2 hover:bg-accent">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className={unread ? 'text-sm font-medium' : 'text-sm'}>{title}</div>
              <div className="text-xs text-muted-foreground">{meta}</div>
            </div>
            {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
          </div>
        ))}
      </div>
      <SheetFooter>
        <Button variant="outline">Mark all as read</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
)

export const SavedSearchAlert = () => (
  <Sheet defaultOpen>
    <MarketplaceBar>
      <SheetTrigger asChild>
        <Button variant="secondary"><Bell /> Save search</Button>
      </SheetTrigger>
    </MarketplaceBar>
    <SheetContent side="bottom" onOpenAutoFocus={noAutoFocus}>
      <SheetHeader>
        <SheetTitle>Save this search</SheetTitle>
        <SheetDescription>Toyota · SUV, Pickup · $8,000 – $40,000 · Harare</SheetDescription>
      </SheetHeader>
      <div className="grid gap-3 px-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="alert-wa" className="font-normal">Alert me on WhatsApp when a new match is published</Label>
          <Switch id="alert-wa" defaultChecked />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="alert-email" className="font-normal">Weekly email digest</Label>
          <Switch id="alert-email" />
        </div>
      </div>
      <SheetFooter className="flex-row justify-end">
        <SheetClose asChild>
          <Button variant="ghost">Cancel</Button>
        </SheetClose>
        <Button>Save search</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
)
