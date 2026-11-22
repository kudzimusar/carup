import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from '@carup/design-system'
import { CalendarCheck, Copy, Mail, MessageCircle, MessageSquare, MoreHorizontal, Send, Share2 } from 'lucide-react'

export const EnquiryDialog = () => (
  <Dialog defaultOpen>
    <DialogTrigger asChild>
      <Button><MessageSquare /> Send an enquiry</Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Send an enquiry</DialogTitle>
        <DialogDescription>
          Toyota Hilux 2.8 GD-6 Raider · 2021 · Harare. Your message stays in a CarUp conversation with the seller.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="enq-name" className="text-xs">Name</Label>
            <Input id="enq-name" defaultValue="Rudo Chikwanha" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="enq-phone" className="text-xs">Phone / WhatsApp</Label>
            <Input id="enq-phone" defaultValue="+263 77 412 0983" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="enq-msg" className="text-xs">Message</Label>
          <Textarea
            id="enq-msg"
            rows={3}
            defaultValue="Hi, is the Hilux still available? I'd like to arrange a viewing in Borrowdale this Saturday."
          />
        </div>
      </div>
      <DialogFooter>
        <Button className="w-full">Send enquiry</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

const shareTargets = [
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Facebook', icon: Share2 },
  { label: 'X', icon: Send },
  { label: 'Email', icon: Mail },
]

export const ShareListing = () => (
  <Dialog defaultOpen>
    <DialogTrigger asChild>
      <Button variant="outline"><Share2 /> Share</Button>
    </DialogTrigger>
    <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Share this vehicle</DialogTitle>
        <DialogDescription>Send the public CarUp listing directly, or copy the link.</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 grid-cols-4 gap-2">
        {shareTargets.map(({ label, icon: Icon }) => (
          <Button key={label} variant="outline" className="h-auto min-w-0 flex-col gap-2 py-4">
            <Icon />
            {label}
          </Button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted p-2">
        <code className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">
          carup.co.zw/marketplace/toyota-hilux-2-8-gd-6-raider-2021-harare
        </code>
        <Button size="sm" variant="outline"><Copy /> Copy</Button>
      </div>
      <Button variant="ghost" className="w-full"><MoreHorizontal /> More sharing options</Button>
    </DialogContent>
  </Dialog>
)

export const InspectionBooking = () => (
  <Dialog defaultOpen>
    <DialogTrigger asChild>
      <Button variant="secondary"><CalendarCheck /> Book inspection</Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Book a pre-purchase inspection</DialogTitle>
        <DialogDescription>
          A CarUp partner mechanic inspects the Honda Fit 1.5 Hybrid at the seller's address in Bulawayo.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="insp-date" className="text-xs">Preferred date</Label>
          <Input id="insp-date" defaultValue="Thu 20 Nov 2026" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="insp-time" className="text-xs">Time window</Label>
          <Input id="insp-time" defaultValue="09:00 – 12:00" />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button>Request slot</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
