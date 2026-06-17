import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, MessageSquare, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { inquiryAttributionFields } from '@/lib/marketplaceReferral'
import { getErrorMessage } from '@/lib/errorMessage'
import type { MarketplaceInquiryType } from '@/types'

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  vehicle_purchase_interest: 'Purchase interest',
  vehicle_inspection_request: 'Request inspection',
  part_quote_request: 'Request a parts quote',
  garage_service_request: 'Request a service',
  import_quote_request: 'Request import quote',
  container_space_interest: 'Reserve container interest',
  dealer_stock_request: 'Ask dealer about stock',
  diaspora_vehicle_request: 'Diaspora vehicle request',
  diaspora_parts_request: 'Diaspora parts request',
  family_purchase_support: 'Family purchase support',
}

const DEFAULT_TYPES: MarketplaceInquiryType[] = ['vehicle_purchase_interest', 'vehicle_inspection_request']

export function InquiryModal({
  listingId,
  inquiryTypes = DEFAULT_TYPES,
  defaultInquiryType,
  triggerLabel = 'Contact seller',
  triggerClassName = '',
  triggerVariant = 'default',
  onSubmitted,
}: {
  listingId?: string
  inquiryTypes?: MarketplaceInquiryType[]
  defaultInquiryType?: MarketplaceInquiryType
  triggerLabel?: string
  triggerClassName?: string
  triggerVariant?: 'default' | 'outline' | 'secondary'
  onSubmitted?: (inquiryId: string) => void
}) {
  const { user } = useAuth()
  const { createMarketplaceInquiry } = useCarUpApi()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [inquiryType, setInquiryType] = useState<MarketplaceInquiryType>(defaultInquiryType || inquiryTypes[0])
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [message, setMessage] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user && !email && !phone) {
      toast.error('Please add an email or phone so the seller can reply.')
      return
    }
    setSubmitting(true)
    try {
      const attribution = inquiryAttributionFields('web')
      const { inquiry } = await createMarketplaceInquiry({
        listing_id: listingId,
        inquiry_type: inquiryType,
        message: message || undefined,
        guest_name: name || undefined,
        guest_email: email || undefined,
        guest_phone: phone || undefined,
        ...attribution,
      })
      toast.success('Inquiry sent. The CarUp team will help connect you safely.')
      setOpen(false)
      setMessage('')
      onSubmitted?.(inquiry.id)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send inquiry. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className={triggerClassName} data-testid="marketplace-inquiry-open">
          <MessageSquare className="mr-2 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid="marketplace-inquiry-modal">
        <DialogHeader>
          <DialogTitle>Send an inquiry</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {inquiryTypes.length > 1 && (
            <div>
              <Label className="mb-1 block text-xs">Inquiry type</Label>
              <Select value={inquiryType} onValueChange={(v) => setInquiryType(v as MarketplaceInquiryType)}>
                <SelectTrigger data-testid="marketplace-inquiry-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {inquiryTypes.map((t) => (
                    <SelectItem key={t} value={t}>{INQUIRY_TYPE_LABELS[t] || t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="mb-1 block text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" data-testid="marketplace-inquiry-name" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-xs">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="marketplace-inquiry-email" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263…" data-testid="marketplace-inquiry-phone" />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about availability, condition, inspection…"
              rows={3}
              data-testid="marketplace-inquiry-message"
            />
          </div>
          <p className="flex items-center gap-1 text-[11px] text-gray-500">
            <ShieldCheck className="h-3 w-3 text-emerald-500" /> Stay on CarUp — never pay outside the verified flow.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={submitting} className="w-full" data-testid="marketplace-inquiry-submit">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : 'Send inquiry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
