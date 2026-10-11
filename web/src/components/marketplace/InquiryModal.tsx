import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Mail, MessageSquare, ShieldCheck } from 'lucide-react'
import { SiWhatsapp } from 'react-icons/si'
import { toast } from 'sonner'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { channelStatus } from '@/lib/communicationChannels'
import { useCommunicationCapabilityState } from '@/hooks/useCommunicationCapability'
import { useAuth } from '@/context/AuthContext'
import { inquiryAttributionFields } from '@/lib/marketplaceReferral'
import { track as trackActivity } from '@/lib/intelligenceActivity'
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

type PreferredContact = 'carup' | 'whatsapp' | 'email'
type ExternalContact = Exclude<PreferredContact, 'carup'>
const EXTERNAL_CONTACTS: ExternalContact[] = ['whatsapp', 'email']

export function InquiryModal({
  listingId,
  inquiryTypes = DEFAULT_TYPES,
  defaultInquiryType,
  triggerLabel = 'Contact seller',
  triggerClassName = '',
  triggerVariant = 'default',
  defaultMessage = '',
  intentMetadata,
  onSubmitted,
  sourceSurface = 'marketplace_detail',
  defaultPreferredContact,
  triggerIcon = 'message',
}: {
  listingId?: string
  inquiryTypes?: MarketplaceInquiryType[]
  defaultInquiryType?: MarketplaceInquiryType
  triggerLabel?: string
  triggerClassName?: string
  triggerVariant?: 'default' | 'outline' | 'secondary'
  defaultMessage?: string
  intentMetadata?: Record<string, unknown>
  onSubmitted?: (inquiryId: string) => void
  sourceSurface?: 'marketplace_detail' | 'marketplace_list' | 'marketplace_compare' | 'dashboard' | 'saved' | 'search' | 'other'
  /** Preselects an external delivery channel (e.g. a WhatsApp-branded entry point). Applied only while that channel is available. */
  defaultPreferredContact?: ExternalContact
  triggerIcon?: 'message' | 'whatsapp'
}) {
  const { user } = useAuth()
  const { createMarketplaceInquiry } = useCarUpApi()
  const location = useLocation()
  // R10 — offer only channels CarUp can actually deliver through (shared, time-bounded health read).
  const { capability, checking } = useCommunicationCapabilityState()
  const isAvailable = (channel: ExternalContact) => channelStatus(capability, channel) === 'available'
  const firstAvailable = EXTERNAL_CONTACTS.find(isAvailable)
  // A guest has no CarUp inbox, so a reply can only reach them through an external channel.
  const guestWithoutChannel = !user && !checking && !firstAvailable
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [inquiryType, setInquiryType] = useState<MarketplaceInquiryType>(defaultInquiryType || inquiryTypes[0])

  // The open action is non-authoritative interaction telemetry. Inquiry truth begins only
  // after the server persists the inquiry row.
  const handleOpenChange = (next: boolean) => {
    if (next && !open) {
      trackActivity({
        event_type: 'marketplace_inquiry_started',
        listing_id: listingId || null,
        source_surface: sourceSurface,
        metadata: { inquiry_type: inquiryType },
      })
    }
    setOpen(next)
  }
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [message, setMessage] = useState(defaultMessage)
  const [chosenContact, setPreferredContact] = useState<PreferredContact>(
    defaultPreferredContact ?? (user ? 'carup' : 'whatsapp'),
  )
  // Once availability is known, an unavailable channel is never the effective choice: it falls back
  // to the CarUp inbox for a signed-in buyer, or to the first working external channel for a guest.
  const preferredContact: PreferredContact = !checking && chosenContact !== 'carup' && !isAvailable(chosenContact)
    ? (user ? 'carup' : firstAvailable ?? chosenContact)
    : chosenContact

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (preferredContact !== 'carup' && !isAvailable(preferredContact)) {
      toast.error(user
        ? 'That delivery channel is not available right now. Choose CarUp to keep the conversation in your inbox.'
        : 'Replies cannot be delivered to a guest right now. Sign in to keep the conversation in your CarUp inbox.')
      return
    }
    if (!user && !email && !phone) {
      toast.error('Please add an email or phone so the conversation can continue.')
      return
    }
    if (preferredContact === 'whatsapp' && !phone) {
      toast.error('Add the WhatsApp number you want CarUp to use for this inquiry.')
      return
    }
    if (preferredContact === 'email' && !email) {
      toast.error('Add the email address you want CarUp to use for this inquiry.')
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
        metadata: { preferred_contact: preferredContact, ...(intentMetadata || {}) },
        ...attribution,
      })
      toast.success('Inquiry sent. Continue the conversation safely through CarUp.')
      setOpen(false)
      setMessage(defaultMessage)
      onSubmitted?.(inquiry.id)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send inquiry. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className={triggerClassName} data-testid="marketplace-inquiry-open">
          {triggerIcon === 'whatsapp'
            ? <SiWhatsapp className="mr-2 h-4 w-4 text-[#25D366]" aria-hidden />
            : <MessageSquare className="mr-2 h-4 w-4" aria-hidden />}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid="marketplace-inquiry-modal">
        <DialogHeader>
          <DialogTitle>Send an inquiry</DialogTitle>
          <DialogDescription>
            Your message stays in a CarUp conversation. You can choose where CarUp should deliver replies.
          </DialogDescription>
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
              <Label className="mb-1 block text-xs">Phone / WhatsApp</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263…" data-testid="marketplace-inquiry-phone" />
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Deliver seller replies through</Label>
            <Select value={preferredContact} onValueChange={(v) => setPreferredContact(v as PreferredContact)}>
              <SelectTrigger data-testid="marketplace-inquiry-preferred-contact" data-preferred-contact={preferredContact}><SelectValue /></SelectTrigger>
              <SelectContent>
                {user && <SelectItem value="carup">CarUp</SelectItem>}
                {/* A channel CarUp cannot currently send through is offered as unavailable rather
                    than silently accepted — choosing it would promise a delivery that cannot occur. */}
                <SelectItem value="whatsapp" disabled={!isAvailable('whatsapp')}>
                  <span className="inline-flex items-center gap-2"><SiWhatsapp className="h-4 w-4 text-[#25D366]" aria-hidden />
                    WhatsApp{checking ? ' — checking…' : !isAvailable('whatsapp') ? ' — unavailable' : ''}</span>
                </SelectItem>
                <SelectItem value="email" disabled={!isAvailable('email')}>
                  <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden />
                    Email{checking ? ' — checking…' : !isAvailable('email') ? ' — unavailable' : ''}</span>
                </SelectItem>
              </SelectContent>
            </Select>
            {guestWithoutChannel ? (
              <p className="mt-1 text-[13px] text-amber-800" data-testid="guest-no-delivery-channel">
                WhatsApp and email replies are not available right now, so a seller could not reach you as a guest.{' '}
                <Link className="font-medium underline" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>
                  Sign in
                </Link>{' '}to keep the conversation in your CarUp inbox.
              </p>
            ) : !checking && (!isAvailable('whatsapp') || !isAvailable('email')) && (
              <p className="mt-1 text-[13px] text-amber-800" data-testid="channel-degraded-note">
                Some delivery channels are unavailable right now. Your message is still recorded and
                replies stay in CarUp.
              </p>
            )}
            <p className="mt-1 text-[13px] text-gray-500">
              This grants transactional contact for this inquiry only. It does not opt you into marketing.
            </p>
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
          <p className="flex items-center gap-1 text-[13px] text-gray-500">
            <ShieldCheck className="h-3 w-3 text-emerald-500" /> Stay on CarUp — never pay outside the verified flow.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={submitting || guestWithoutChannel} className="w-full" data-testid="marketplace-inquiry-submit">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : 'Send inquiry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
