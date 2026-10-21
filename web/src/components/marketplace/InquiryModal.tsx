import { useRef, useState } from 'react'
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

/**
 * OC-NATIVE-FINAL-02-R1 P2-B — the backend resolves a seller ONLY for these types on a listing
 * (marketplaceInquiryService VEHICLE_BOUND_TYPES). Any other inquiry is recorded with no seller for
 * CarUp's marketplace reviewers, so the modal must not promise that a seller receives it.
 */
const SELLER_BOUND_INQUIRY_TYPES: readonly string[] = ['vehicle_purchase_interest', 'vehicle_inspection_request', 'dealer_stock_request', 'trade_in_request']

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
  // A guest has no CarUp inbox. When CarUp cannot deliver by WhatsApp or email, the inquiry is still
  // accepted (product authority: a guest inquiry with an email or phone reaches the seller, who sees
  // those contact details) — the guest is told so, never blocked.
  const guestDeliveryPaused = !user && !checking && !firstAvailable
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [inquiryType, setInquiryType] = useState<MarketplaceInquiryType>(defaultInquiryType || inquiryTypes[0])
  const sellerResolved = Boolean(listingId) && SELLER_BOUND_INQUIRY_TYPES.includes(inquiryType)

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

  // One idempotency key per composed message: a double click or a retry of the same words is recorded once by
  // the server; editing the message starts a new key (it is a different message).
  const requestKeyRef = useRef<{ message: string; key: string } | null>(null)
  const inFlightRef = useRef(false)
  const requestKeyFor = (text: string): string => {
    if (!requestKeyRef.current || requestKeyRef.current.message !== text) {
      const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : Math.random().toString(36).slice(2, 14)
      requestKeyRef.current = { message: text, key: `web-${Date.now().toString(36)}-${random}` }
    }
    return requestKeyRef.current.key
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current) return
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
    inFlightRef.current = true
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
        client_request_id: requestKeyFor(message || ''),
      })
      requestKeyRef.current = null
      toast.success(sellerResolved
        ? 'Inquiry sent. Continue the conversation safely through CarUp.'
        : 'Request recorded. It has not been sent to a seller or supplier.')
      setOpen(false)
      setMessage(defaultMessage)
      onSubmitted?.(inquiry.id)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send inquiry. Please try again.'))
    } finally {
      inFlightRef.current = false
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
          {!sellerResolved && (
            <p className="text-[13px] text-amber-800" data-testid="inquiry-recipient-note">
              This request is not sent to a particular seller or supplier. CarUp records it for its
              marketplace team, and no one is contacted automatically.
            </p>
          )}
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
            <Label className="mb-1 block text-xs">{sellerResolved ? 'Deliver seller replies through' : 'Deliver replies through'}</Label>
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
            {guestDeliveryPaused ? (
              <p className="mt-1 text-[13px] text-amber-800" data-testid="guest-delivery-paused">
                CarUp can&rsquo;t deliver replies by WhatsApp or email right now.{' '}
                {sellerResolved
                  ? 'Your inquiry still reaches the seller with the contact details you leave here.'
                  : 'Your request is still recorded with the contact details you leave here.'}{' '}
                <Link className="font-medium underline" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>
                  Sign in
                </Link>{' '}to follow it in your CarUp inbox.
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
            <Button type="submit" disabled={submitting} className="w-full" data-testid="marketplace-inquiry-submit">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : 'Send inquiry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
