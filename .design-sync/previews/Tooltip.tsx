import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@carup/design-system'
import { CalendarCheck, Heart, Scale, Share2 } from 'lucide-react'

export const CompareHint = () => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3" style={{ marginTop: 56 }}>
    <div>
      <div className="text-sm font-semibold">Mazda CX-5 2.2D Akera</div>
      <div className="text-xs text-muted-foreground">2019 · 71,000 km · Harare</div>
    </div>
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Save vehicle"><Heart /></Button>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Add to compare"><Scale /></Button>
        </TooltipTrigger>
        <TooltipContent>Add to compare (2 of 4)</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="icon-sm" aria-label="Share"><Share2 /></Button>
    </div>
  </div>
)

export const DisabledReason = () => (
  <div className="flex justify-center" style={{ marginTop: 64 }}>
    <Tooltip open>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button disabled><CalendarCheck /> Book inspection</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Available once the seller confirms a viewing address</TooltipContent>
    </Tooltip>
  </div>
)

export const SideAndStatus = () => (
  <div className="flex items-center gap-3" style={{ marginTop: 32 }}>
    <span className="text-sm font-medium">Honda Fit 1.5 Hybrid</span>
    <Tooltip open>
      <TooltipTrigger asChild>
        <Badge variant="outline">Reserved</Badge>
      </TooltipTrigger>
      <TooltipContent side="right" style={{ maxWidth: 200 }}>Reserved by the seller on 14 Nov · enquiries stay open</TooltipContent>
    </Tooltip>
  </div>
)
