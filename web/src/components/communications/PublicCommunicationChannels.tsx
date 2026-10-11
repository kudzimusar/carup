import { Mail } from 'lucide-react'
import { SiTelegram, SiWhatsapp } from 'react-icons/si'
import { useCommunicationCapabilityState } from '@/hooks/useCommunicationCapability'
import { CHANNEL_AVAILABILITY_LABEL, channelAvailability, type ChannelAvailability } from '@/lib/communicationChannels'

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: SiWhatsapp, iconClass: 'text-[#25D366]', use: 'Choose WhatsApp when you ask about a listing. Replies stay linked to your CarUp conversation.' },
  { key: 'telegram', label: 'Telegram', icon: SiTelegram, iconClass: 'text-[#26A5E4]', use: 'Used for CarUp conversation and support updates where you have connected Telegram.' },
  { key: 'email', label: 'Email', icon: Mail, iconClass: 'text-slate-700', use: 'Inquiry replies, account and security messages.' },
] as const

const TONE: Record<ChannelAvailability, string> = {
  available: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  temporarily_unavailable: 'bg-amber-50 text-amber-800 ring-amber-200',
  setup_pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  not_offered: 'bg-slate-100 text-slate-600 ring-slate-200',
  checking: 'bg-slate-50 text-slate-600 ring-slate-200',
  unknown: 'bg-slate-50 text-slate-600 ring-slate-200',
}

function detailFor(state: ChannelAvailability, label: string, use: string): string {
  switch (state) {
    case 'available': return use
    case 'temporarily_unavailable': return `CarUp supports ${label}, but delivery is paused here right now. Your messages stay in CarUp.`
    case 'setup_pending': return `CarUp supports ${label}. This environment is not connected to it yet, so use CarUp messages for now.`
    case 'not_offered': return `${label} is not currently offered.`
    case 'checking': return `Checking whether ${label} is connected…`
    default: return `We could not check ${label} right now. Your CarUp conversation is unaffected.`
  }
}

export function PublicCommunicationChannels() {
  const { capability, checking } = useCommunicationCapabilityState()
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contact-delivery-channels" data-testid="public-communication-channels">
      <h2 id="contact-delivery-channels" className="font-semibold text-slate-900">Your conversation, your channel</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">CarUp supports WhatsApp, Telegram and email alongside in-app conversations. Each one shows whether it is working here right now.</p>
      <ul className="mt-4 space-y-4">
        {CHANNELS.map(({ key, label, icon: Icon, iconClass, use }) => {
          const state = channelAvailability(capability, key, { checking })
          return (
            <li key={key} className="flex gap-3" data-testid={`channel-${key}`} data-availability={state}>
              <Icon className={`mt-1 h-6 w-6 shrink-0 ${iconClass}`} aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {label}
                  <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ring-1 ${TONE[state]}`} data-testid={`channel-${key}-status`}>
                    {CHANNEL_AVAILABILITY_LABEL[state]}
                  </span>
                </p>
                <p className="text-sm text-slate-600">{detailFor(state, label, use)}</p>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-sm text-slate-600">A channel name alone does not prove a message is genuine. Open carup.dev yourself to check the conversation. CarUp never asks for your password or recovery code.</p>
    </section>
  )
}
