import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LifeBuoy, Mail, MessageSquare, ShieldCheck, Car, Globe2, KeyRound } from 'lucide-react'

import { usePageMetadata } from '@/lib/usePageMetadata'

/**
 * CarUp Support — the destination `support@carup.dev` and every transactional Email footer links to.
 *
 * Deliberately its own route rather than an alias to /help. Email footers say "Support", and a link
 * whose label and destination disagree is the kind of small dishonesty that erodes trust in the
 * whole message. The Help Center is linked from here where it genuinely helps.
 *
 * Everything on this page is a capability CarUp actually has. There is no telephone line, no
 * 24/7 promise, no opening hours, no SLA, no live chat, no ticket queue and no named support staff,
 * because none of those exist — and a support page that promises a channel nobody answers is worse
 * than no support page.
 */

const SUPPORT_EMAIL = 'support@carup.dev'
const QUESTIONS_EMAIL = 'questions@carup.dev'
const SECURITY_EMAIL = 'security@carup.dev'

const TOPICS = [
  {
    icon: KeyRound,
    title: 'Account and sign-in',
    body: 'Trouble signing in, resetting your password, or confirming your email address. Include the email address on the account — never your password.',
  },
  {
    icon: Car,
    title: 'Marketplace buying and selling',
    body: 'Questions about a listing, a seller, an inquiry you sent, or a listing you published. Include the listing link if you have it.',
  },
  {
    icon: ShieldCheck,
    title: 'Vehicle Passport and vehicle evidence',
    body: 'Questions about what a vehicle record shows, where a piece of evidence came from, or why something is recorded as unavailable rather than confirmed.',
  },
  {
    icon: Globe2,
    title: 'Diaspora imports and SafeTrade',
    body: 'Questions about an import order, container space, or a SafeTrade journey you have started on CarUp.',
  },
  {
    icon: MessageSquare,
    title: 'Messages and conversations',
    body: 'A CarUp conversation you cannot find, a reply that did not arrive, or email from CarUp you did not expect.',
  },
  {
    icon: LifeBuoy,
    title: 'Anything else',
    body: 'General questions about CarUp, how it works, or what it can do for you.',
  },
]

export default function Support() {
  usePageMetadata({
    title: 'CarUp Support | Get help with your account, listings and vehicle records',
    description:
      'Get help with your CarUp account, Marketplace listings, Vehicle Passport records, diaspora imports and CarUp conversations. Contact support@carup.dev.',
    canonicalPath: '/support',
  })

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
      <header className="mb-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-orange-700">
          <LifeBuoy className="h-4 w-4" aria-hidden="true" />
          Support
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">CarUp Support</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
          Tell us what you were trying to do and what happened instead. The more specific you are — a
          listing link, an order reference, the email address on your account — the faster we can help.
        </p>
      </header>

      <Card className="mb-10 border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5 text-orange-700" aria-hidden="true" />
            How to reach us
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-slate-700">
          <p>
            <strong className="font-semibold text-slate-900">Support:</strong>{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            — the right address for anything about your account, a listing, a vehicle record or an order.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">General questions:</strong>{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${QUESTIONS_EMAIL}`}>
              {QUESTIONS_EMAIL}
            </a>{' '}
            — a shared address for general and business questions. It is not a replacement for{' '}
            {SUPPORT_EMAIL}, and account or order issues are handled faster there.
          </p>
          <p className="text-slate-600">
            You can also reply directly to a CarUp conversation email — replies come back to the same
            conversation.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="support-topics" className="mb-10">
        <h2 id="support-topics" className="mb-5 text-xl font-semibold text-slate-900">
          What we can help with
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TOPICS.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4 text-orange-700" aria-hidden="true" />
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-slate-600">{body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="support-elsewhere" className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h2 id="support-elsewhere" className="mb-3 text-lg font-semibold text-slate-900">
          Some questions belong somewhere else
        </h2>
        <ul className="space-y-3 text-sm leading-relaxed text-slate-700">
          <li>
            <strong className="font-semibold text-slate-900">Security or a suspicious message.</strong>{' '}
            If an email claiming to be from CarUp looks wrong, do not act on it. See{' '}
            <Link className="font-medium text-orange-700 underline" to="/security">
              CarUp Security
            </Link>{' '}
            or write to{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </a>
            .
          </li>
          <li>
            <strong className="font-semibold text-slate-900">Your personal data.</strong> How CarUp
            handles your information, and how to ask about it, is set out in the{' '}
            <Link className="font-medium text-orange-700 underline" to="/privacy">
              Privacy Policy
            </Link>
            .
          </li>
          <li>
            <strong className="font-semibold text-slate-900">How something works.</strong> The{' '}
            <Link className="font-medium text-orange-700 underline" to="/help">
              Help Center
            </Link>{' '}
            covers common questions, and{' '}
            <Link className="font-medium text-orange-700 underline" to="/trust">
              Trust &amp; Safety
            </Link>{' '}
            explains how CarUp verifies what it publishes.
          </li>
        </ul>
      </section>
    </main>
  )
}
