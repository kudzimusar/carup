import { SiTelegram, SiWhatsapp } from 'react-icons/si'
import { useCommunicationCapability } from '@/hooks/useCommunicationCapability'

export function PublicCommunicationChannels() {
  const capability = useCommunicationCapability()
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contact-delivery-channels" data-testid="public-communication-channels">
      <h2 id="contact-delivery-channels" className="font-semibold text-slate-900">Your conversation, your channel</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">CarUp supports WhatsApp and Telegram alongside in-app conversations. Channel availability depends on the environment you are using.</p>
      <ul className="mt-4 space-y-4">
        {([{ key: 'whatsapp', label: 'WhatsApp', icon: SiWhatsapp }, { key: 'telegram', label: 'Telegram', icon: SiTelegram }] as const).map(({ key, label, icon: Icon }) => {
          const evidence = capability.evidence?.[key]
          const detail = capability.unknown ? 'Current connection could not be confirmed.'
            : evidence?.currentRuntimeReady ? 'Connected; current delivery certification is pending.'
              : 'Temporarily unavailable in this environment. Use CarUp conversations or email.'
          return <li key={key} className="flex gap-3"><Icon className="mt-1 h-6 w-6 shrink-0" aria-hidden /><div><p className="font-medium text-slate-900">{label}</p><p className="text-sm text-slate-600">{detail}</p></div></li>
        })}
      </ul>
      <p className="mt-4 text-sm text-slate-600">A channel name alone does not prove a message is genuine. Open carup.dev yourself to check the conversation. CarUp never asks for your password or recovery code.</p>
    </section>
  )
}
