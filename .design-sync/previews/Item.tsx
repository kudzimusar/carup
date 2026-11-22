import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  MoneyDisplay,
  TrustLens,
} from '@carup/design-system'
import { Bell, Car, ChevronRight, ClipboardCheck, FileText, Search, Wrench } from 'lucide-react'

export const Variants = () => (
  <div className="flex flex-col gap-3" style={{ width: 520 }}>
    <Item>
      <ItemMedia variant="icon"><ClipboardCheck /></ItemMedia>
      <ItemContent>
        <ItemTitle>Pre-purchase inspection booked</ItemTitle>
        <ItemDescription>Mukuvisi Auto Clinic · Thu 20 Nov, 09:30</ItemDescription>
      </ItemContent>
      <ItemActions><Button variant="outline" size="sm">Reschedule</Button></ItemActions>
    </Item>
    <Item variant="outline">
      <ItemMedia variant="icon"><FileText /></ItemMedia>
      <ItemContent>
        <ItemTitle>Logbook uploaded</ItemTitle>
        <ItemDescription>Awaiting review by the CarUp trust team.</ItemDescription>
      </ItemContent>
      <ItemActions><Button variant="ghost" size="sm">View</Button></ItemActions>
    </Item>
    <Item variant="muted">
      <ItemMedia variant="icon"><Wrench /></ItemMedia>
      <ItemContent>
        <ItemTitle>Service due in 1,200 km</ItemTitle>
        <ItemDescription>Last serviced at 58,900 km on 12 Sep 2026.</ItemDescription>
      </ItemContent>
      <ItemActions><Button size="sm">Book service</Button></ItemActions>
    </Item>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-col gap-3" style={{ width: 520 }}>
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>Default size</ItemTitle>
        <ItemDescription>Saved search: SUVs under $25,000 in Harare</ItemDescription>
      </ItemContent>
      <ItemActions><Badge>18 matches</Badge></ItemActions>
    </Item>
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle>Small size</ItemTitle>
        <ItemDescription>Saved search: Honda Fit, 2015 or newer</ItemDescription>
      </ItemContent>
      <ItemActions><Badge variant="secondary">6 matches</Badge></ItemActions>
    </Item>
  </div>
)

const searches = [
  { title: 'Toyota Hilux, diesel, 4x4', meta: 'Harare · up to $40,000', count: 9, alert: true },
  { title: 'Mazda CX-5, 2018+', meta: 'Anywhere in Zimbabwe · up to $28,000', count: 4, alert: true },
  { title: 'Nissan NP200', meta: 'Bulawayo · any price', count: 0, alert: false },
]

export const SavedSearches = () => (
  <ItemGroup className="rounded-lg border bg-card" style={{ width: 520 }}>
    {searches.map((s, i) => (
      <div key={s.title}>
        {i > 0 && <ItemSeparator />}
        <Item size="sm" asChild>
          <a href="#saved-search">
            <ItemMedia variant="icon"><Search /></ItemMedia>
            <ItemContent>
              <ItemTitle>{s.title}</ItemTitle>
              <ItemDescription>{s.meta}</ItemDescription>
            </ItemContent>
            <ItemActions>
              {s.alert ? <Bell className="size-4 text-carup-action" aria-label="Alerts on" /> : null}
              <Badge variant={s.count ? 'default' : 'secondary'}>{s.count} new</Badge>
              <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </a>
        </Item>
      </div>
    ))}
  </ItemGroup>
)

export const ListingRow = () => (
  <Item variant="outline" style={{ width: 600 }}>
    <ItemHeader>
      <span className="text-xs text-muted-foreground">Listed 3 days ago · Borrowdale Motors</span>
      <Badge variant="secondary">Dealer</Badge>
    </ItemHeader>
    <ItemMedia variant="image" className="bg-carup-bg-surface" style={{ width: 64, height: 48 }}>
      <Car className="size-6 text-carup-text-3" />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>Mazda CX-5 2.0 Active</ItemTitle>
      <ItemDescription>2019 · 71,300 km · Petrol · Automatic</ItemDescription>
    </ItemContent>
    <ItemContent className="items-end">
      <MoneyDisplay amount={21900} currency="USD" source="asking" />
    </ItemContent>
    <ItemFooter>
      <TrustLens state="partial" sourceCount={2} freshness="10 Nov 2026" />
      <Button variant="link" size="sm" className="h-auto px-0">Compare</Button>
    </ItemFooter>
  </Item>
)
