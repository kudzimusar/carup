import { Badge } from '@carup/design-system'
import { Clock, Fuel, MapPin, Settings2, Star } from 'lucide-react'

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Featured</Badge>
    <Badge variant="secondary">Dealer</Badge>
    <Badge variant="outline">Private seller</Badge>
    <Badge variant="destructive">Withdrawn</Badge>
  </div>
)

export const ListingStatus = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="outline" className="border-status-success bg-status-success-soft text-status-success">Live</Badge>
    <Badge variant="outline" className="border-status-warning bg-status-warning-soft text-status-warning">Reserved</Badge>
    <Badge variant="outline" className="border-status-info bg-status-info-soft text-status-info">Under offer</Badge>
    <Badge variant="outline" className="border-status-neutral bg-status-neutral-soft text-status-neutral">Sold</Badge>
    <Badge variant="outline" className="border-status-danger bg-status-danger-soft text-status-danger">Listing expired</Badge>
  </div>
)

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="secondary"><MapPin /> Harare</Badge>
    <Badge variant="secondary"><Fuel /> Diesel</Badge>
    <Badge variant="secondary"><Settings2 /> Automatic</Badge>
    <Badge variant="outline"><Clock /> Listed 3 days ago</Badge>
    <Badge><Star /> Featured</Badge>
  </div>
)

export const Counts = () => (
  <div className="flex flex-wrap items-center gap-6 text-sm">
    <span className="inline-flex items-center gap-2 font-medium">Enquiries <Badge>12</Badge></span>
    <span className="inline-flex items-center gap-2 font-medium">Saved searches <Badge variant="secondary">4</Badge></span>
    <span className="inline-flex items-center gap-2 font-medium">Unread messages <Badge variant="destructive">3</Badge></span>
  </div>
)
