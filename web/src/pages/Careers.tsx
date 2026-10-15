import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Mail, ArrowRight } from 'lucide-react'
import { usePageMetadata } from '@/lib/usePageMetadata'
import { PUBLIC_CONTACTS, PUBLIC_IDENTITY } from '@/config/publicIdentity'

/**
 * Careers — PC01-J-R1 (Owner Usability Checkpoint 1).
 *
 * This page used to advertise six openings with salary bands, perks (a fuel allowance, a named
 * health insurer, an equity pool, a "Quarterly Adventure Drive") and two "state-of-the-art hubs" in
 * Harare (Avondale) and Bulawayo — none of it approved, much of it invented. Its application form
 * took a name, an email address, a phone number and a CV, waited 1.8 seconds on a timer and then
 * announced the application had been submitted. Nothing was stored or sent: personal data was
 * collected and silently discarded behind a success screen.
 *
 * What is true is short: CarUp is not advertising roles here, and the approved general address
 * (`info@carup.dev`, per the owner-frozen contact mapping §3.2) is where an interested person can
 * write. No form, no salary, no perk and no response time is published until one is real.
 */
export default function Careers() {
  usePageMetadata({
    title: 'Careers at CarUp',
    description: `CarUp is not advertising open roles on this site right now. To introduce yourself, write to ${PUBLIC_CONTACTS.info}.`,
    canonicalPath: '/careers',
  })

  return (
    <div className="min-h-screen bg-gray-50" data-testid="page-careers">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] py-12 text-white sm:py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <Badge className="mb-4 bg-orange-500/20 text-orange-300">Careers</Badge>
          <h1 className="mb-4 text-3xl font-bold md:text-4xl">Careers at CarUp</h1>
          <p className="mx-auto max-w-xl text-gray-300">
            {PUBLIC_IDENTITY.legalEntity} is not advertising open roles on this site right now.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-3xl space-y-6 py-12 sm:py-16">
        <Card className="border-slate-200 py-0" data-testid="careers-introduce-yourself">
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Interested in working with CarUp?</h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Write a short note about yourself and the kind of work you do. Please do not send identity
              documents, bank details or other sensitive personal information by email.
            </p>
            <a
              href={`mailto:${PUBLIC_CONTACTS.info}`}
              className="inline-flex min-h-11 items-center gap-2 break-all font-medium text-orange-700 underline"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {PUBLIC_CONTACTS.info}
            </a>
          </CardContent>
        </Card>

        <Card className="border-slate-200 py-0" data-testid="careers-not-offered">
          <CardContent className="p-6 text-sm leading-relaxed text-slate-600">
            There is no application form on this page, and CarUp publishes no salary bands, benefits or response
            times until a role is genuinely open.
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Link to="/about" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-orange-700 underline">
            About CarUp <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to="/contact" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-orange-700 underline">
            Contact CarUp <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
