import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  MoneyDisplay,
  VehicleIdentity,
} from '@carup/design-system'
import { CalendarDays, Car, Clock, MapPin } from 'lucide-react'

export const SellerProfile = () => (
  <p className="text-sm text-muted-foreground">
    Listed by{' '}
    <HoverCard open>
      <HoverCardTrigger asChild>
        <Button variant="link" className="h-auto px-0">Tendai Motors</Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <div className="flex gap-3">
          <Avatar className="size-10">
            <AvatarFallback>TM</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">Tendai Motors</h4>
              <Badge variant="secondary">Dealer</Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> Borrowdale, Harare
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Car className="size-3.5" /> 42 published listings
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> Usually replies within 2 hours
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" /> On CarUp since March 2023
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
    {' '}· Harare
  </p>
)

export const VehiclePeek = () => (
  <p className="text-sm">
    Similar to{' '}
    <HoverCard open>
      <HoverCardTrigger asChild>
        <Button variant="link" className="h-auto px-0">Toyota Hilux 2.8 GD-6 Raider</Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 space-y-3">
        <VehicleIdentity
          title="Toyota Hilux 2.8 GD-6 Raider"
          variant="row"
          year={2021}
          mileageKm={62400}
          location="Harare"
        />
        <MoneyDisplay amount={38500} currency="USD" source="asking" />
      </HoverCardContent>
    </HoverCard>
    {' '}you saved last week.
  </p>
)
