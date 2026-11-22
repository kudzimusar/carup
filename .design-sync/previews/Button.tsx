import { Button } from '@carup/design-system'
import { ArrowRight, Heart, Loader2, Phone, Search, SlidersHorizontal } from 'lucide-react'

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>Contact seller</Button>
    <Button variant="secondary">Save search</Button>
    <Button variant="outline">Compare</Button>
    <Button variant="ghost">View history</Button>
    <Button variant="link">See all listings</Button>
    <Button variant="destructive">Withdraw listing</Button>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Book inspection</Button>
    <Button>Book inspection</Button>
    <Button size="lg">Book inspection</Button>
    <Button size="icon-sm" variant="outline" aria-label="Save vehicle"><Heart /></Button>
    <Button size="icon" variant="outline" aria-label="Filters"><SlidersHorizontal /></Button>
    <Button size="icon-lg" variant="outline" aria-label="Search"><Search /></Button>
  </div>
)

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button><Phone /> Call dealer</Button>
    <Button variant="outline">Search marketplace <ArrowRight /></Button>
    <Button variant="secondary"><Heart /> Saved</Button>
  </div>
)

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>Reserved</Button>
    <Button disabled><Loader2 className="animate-spin" /> Sending enquiry</Button>
    <Button variant="outline" disabled>Compare (4 max)</Button>
  </div>
)
