import { Toggle } from '@carup/design-system'
import { Bookmark, Gauge, Heart, ShieldCheck } from 'lucide-react'

export const Default = () => (
  <div className="flex items-center gap-2">
    <Toggle aria-label="Save vehicle"><Heart /> Save</Toggle>
    <Toggle aria-label="Saved vehicle" defaultPressed><Heart /> Saved</Toggle>
  </div>
)

export const Outline = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Toggle variant="outline" defaultPressed>4x4 only</Toggle>
    <Toggle variant="outline">Automatic</Toggle>
    <Toggle variant="outline"><ShieldCheck /> Dealer listings</Toggle>
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-2">
    <Toggle variant="outline" size="sm" aria-label="Bookmark (small)"><Bookmark /></Toggle>
    <Toggle variant="outline" aria-label="Bookmark"><Bookmark /></Toggle>
    <Toggle variant="outline" size="lg" aria-label="Bookmark (large)"><Bookmark /></Toggle>
  </div>
)

export const Disabled = () => (
  <div className="flex items-center gap-2">
    <Toggle variant="outline" disabled><Gauge /> Low mileage</Toggle>
    <Toggle variant="outline" disabled defaultPressed>Under $10,000</Toggle>
  </div>
)
