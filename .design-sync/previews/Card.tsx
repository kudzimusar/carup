import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  MoneyDisplay,
  TrustLens,
} from '@carup/design-system'
import { Gauge, MapPin } from 'lucide-react'

export const ListingCard = () => (
  <Card className="w-[340px]">
    <CardHeader>
      <CardTitle>Toyota Hilux 2.8 GD-6 Raider</CardTitle>
      <CardDescription className="flex items-center gap-3">
        <span>2021</span>
        <span className="inline-flex items-center gap-1"><Gauge className="size-3.5" /> 62,400 km</span>
        <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> Harare</span>
      </CardDescription>
      <CardAction><Badge variant="secondary">Dealer</Badge></CardAction>
    </CardHeader>
    <CardContent className="space-y-3">
      <MoneyDisplay amount={38500} currency="USD" source="asking" size="lg" />
      <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
    </CardContent>
    <CardFooter className="gap-2">
      <Button className="flex-1">Contact seller</Button>
      <Button variant="outline">Save</Button>
    </CardFooter>
  </Card>
)

export const SummaryPanel = () => (
  <Card className="w-[340px]">
    <CardHeader>
      <CardTitle>Service history</CardTitle>
      <CardDescription>Records submitted by the seller and governed sources.</CardDescription>
    </CardHeader>
    <CardContent>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Last service</dt>
        <dd className="text-right font-medium">12 Sep 2026</dd>
        <dt className="text-muted-foreground">Records held</dt>
        <dd className="text-right font-medium">4</dd>
        <dt className="text-muted-foreground">Odometer at service</dt>
        <dd className="text-right font-medium">58,900 km</dd>
      </dl>
    </CardContent>
  </Card>
)

export const WithActionAndFooter = () => (
  <Card className="w-[340px]">
    <CardHeader>
      <CardTitle>Saved search</CardTitle>
      <CardDescription>SUVs under $25,000 in Harare · 18 matches</CardDescription>
      <CardAction><Button variant="link" size="sm">Edit</Button></CardAction>
    </CardHeader>
    <CardContent className="text-sm text-muted-foreground">
      You'll get an alert when a new listing matches these filters.
    </CardContent>
    <CardFooter className="justify-end gap-2 border-t">
      <Button variant="ghost" size="sm">Pause alerts</Button>
      <Button size="sm">View matches</Button>
    </CardFooter>
  </Card>
)
