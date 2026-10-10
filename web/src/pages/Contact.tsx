import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Mail, MapPin, MessageSquare, Ban, LifeBuoy, ShieldCheck, HelpCircle, ArrowRight } from 'lucide-react'
import { usePageMetadata } from '@/lib/usePageMetadata'
import { CONTACT_PURPOSES, PUBLIC_CONTACTS, PUBLIC_IDENTITY, PUBLIC_LOCATION_LINE } from '@/config/publicIdentity'

/**
 * Contact — PC01-J-R1 (Owner Usability Checkpoint 1).
 *
 * This page used to publish a contact form that could not send, a "Business Hours" block nobody
 * keeps, an email on a domain CarUp does not use (`@carup.co.zw`), a phone line that read "Not
 * published yet", and a card sending people to Gutu — an assistant that reads account records and is
 * not a support channel. Each was a promise with nothing behind it.
 *
 * What is genuinely ready, and so the only thing advertised:
 *   · email to the certified `@carup.dev` aliases (inbound routing physically certified — see
 *     docs/communications/EMAIL_EXPERIENCE_1_0_CONTACT_IDENTITY_MAPPING.md), one per purpose;
 *   · in-product conversations with a seller about a listing (sign-in at the point of messaging).
 *
 * Everything else — telephone, WhatsApp, SMS, Telegram, social media, live chat, a contact form,
 * opening hours, response times — does not exist yet, and the page says so rather than going quiet.
 */
const UNAVAILABLE_CHANNELS = [
  { channel: 'Telephone', detail: 'CarUp has no public phone number.' },
  { channel: 'WhatsApp, SMS and Telegram', detail: 'Not connected. A message on these channels claiming to be CarUp is not from CarUp.' },
  { channel: 'Social media', detail: 'CarUp publishes no official Facebook, Instagram, X or LinkedIn account yet.' },
  { channel: 'Live chat or a contact form', detail: 'Not available — email is the way to reach CarUp.' },
  { channel: 'Opening hours and response times', detail: 'CarUp publishes none, because it measures none.' },
]

export default function Contact() {
  usePageMetadata({
    title: 'Contact CarUp | Reach the right team by email',
    description: `How to reach CarUp: write to the address for your purpose — help with an account or listing at ${PUBLIC_CONTACTS.support}, security concerns at ${PUBLIC_CONTACTS.security}, privacy requests at ${PUBLIC_CONTACTS.privacy}.`,
    canonicalPath: '/contact',
  })

  return (
    <div className="min-h-screen bg-gray-50" data-testid="page-contact">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] py-12 text-white sm:py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <Badge className="mb-4 bg-orange-500/20 text-orange-300">Contact</Badge>
          <h1 className="mb-4 text-3xl font-bold md:text-4xl">Contact CarUp</h1>
          <p className="mx-auto max-w-xl text-gray-300">
            CarUp is reached by email. Write to the address for your purpose below, with enough detail for the team to
            find what you mean.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-3">
          <section aria-labelledby="contact-purposes" className="lg:col-span-2">
            <h2 id="contact-purposes" className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-900">
              <Mail className="h-5 w-5 text-orange-600" aria-hidden="true" /> Write to the right address
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {CONTACT_PURPOSES.map(({ purpose, title, detail }) => (
                <li key={purpose} data-testid={`contact-purpose-${purpose}`}>
                  <Card className="h-full border-slate-200 py-0">
                    <CardContent className="p-5">
                      <p className="font-semibold text-slate-900">{title}</p>
                      <a
                        className="mt-2 inline-flex min-h-11 items-center break-all font-medium text-orange-700 underline"
                        href={`mailto:${PUBLIC_CONTACTS[purpose]}`}
                      >
                        {PUBLIC_CONTACTS[purpose]}
                      </a>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{detail}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <div className="space-y-6">
            <Card className="border-slate-200 py-0" data-testid="contact-listing-conversations">
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                  <MessageSquare className="h-5 w-5 text-orange-600" aria-hidden="true" /> About a specific vehicle?
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Message the seller from the listing. The conversation stays on CarUp, and you are asked to sign in
                  only when you send your first message — browsing never needs an account.
                </p>
                <Link
                  to="/marketplace"
                  className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-medium text-orange-700 underline"
                >
                  Browse the Marketplace <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-slate-200 py-0" data-testid="contact-location">
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                  <MapPin className="h-5 w-5 text-orange-600" aria-hidden="true" /> Where CarUp is
                </h2>
                <p className="mt-2 text-sm text-slate-700">{PUBLIC_LOCATION_LINE}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {PUBLIC_IDENTITY.legalEntity} has no public office or street address to visit.
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 py-0" data-testid="contact-unavailable-channels">
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                  <Ban className="h-5 w-5 text-slate-500" aria-hidden="true" /> Not offered yet
                </h2>
                <dl className="mt-3 space-y-3 text-sm">
                  {UNAVAILABLE_CHANNELS.map(({ channel, detail }) => (
                    <div key={channel}>
                      <dt className="font-medium text-slate-900">{channel}</dt>
                      <dd className="text-slate-600">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>

        <nav aria-label="More help" className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { to: '/support', label: 'CarUp Support', icon: LifeBuoy },
            { to: '/help', label: 'Help Center', icon: HelpCircle },
            { to: '/security', label: 'Security and suspicious messages', icon: ShieldCheck },
          ].map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 font-medium text-slate-800 hover:border-orange-300"
            >
              <Icon className="h-4 w-4 text-orange-600" aria-hidden="true" /> {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
