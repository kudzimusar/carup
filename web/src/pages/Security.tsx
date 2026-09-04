import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldAlert, Mail, KeyRound, Link2, EyeOff, AlertTriangle } from 'lucide-react'

import { usePageMetadata } from '@/lib/usePageMetadata'

/**
 * CarUp Security — account safety, phishing guidance, and where to report a security concern.
 *
 * Deliberately distinct from /trust. Trust & Safety is about the product: how CarUp verifies what it
 * publishes about a vehicle. This page is about the customer's account and the messages they
 * receive, which is a different question asked by a different person in a different moment — usually
 * a worried one.
 *
 * No security certification, SOC/ISO claim, bug bounty, hotline, guaranteed response time, insurance
 * or law-enforcement partnership is asserted, because CarUp has none of them. On a security page
 * specifically, an unearned assurance is not marketing overreach — it is the thing that persuades
 * someone to trust a message they should have questioned.
 */

const SECURITY_EMAIL = 'security@carup.dev'
const SUPPORT_EMAIL = 'support@carup.dev'
const CANONICAL_DOMAIN = 'carup.dev'

const NEVER_ASKED = [
  'your password',
  'a one-time code or OTP',
  'a password-reset link or token from an email',
  'any other private authentication credential',
]

export default function Security() {
  usePageMetadata({
    title: 'CarUp Security | Account safety, phishing guidance and reporting',
    description:
      'How to keep your CarUp account safe, how to recognise a suspicious message, what CarUp will never ask you for by email, and how to report a security concern to security@carup.dev.',
    canonicalPath: '/security',
  })

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
      <header className="mb-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          Security
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">CarUp Security</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
          How to keep your CarUp account safe, how to tell a real CarUp message from one pretending to
          be us, and how to tell us when something looks wrong.
        </p>
      </header>

      <Card className="mb-10 border-orange-200 bg-orange-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <EyeOff className="h-5 w-5 text-orange-700" aria-hidden="true" />
            What CarUp will never ask you for
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>CarUp will never ask you to send, reply with, or read out:</p>
          <ul className="list-disc space-y-1 pl-5">
            {NEVER_ASKED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="font-medium text-slate-900">
            If a message asks for any of these, it is not from CarUp. Do not reply to it, and do not
            act on it.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="report" className="mb-10">
        <h2 id="report" className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Mail className="h-5 w-5 text-orange-700" aria-hidden="true" />
          Reporting a security concern
        </h2>
        <div className="space-y-4 text-sm leading-relaxed text-slate-700">
          <p>
            Write to{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </a>{' '}
            if you receive a suspicious message that appears to come from CarUp, believe your account
            has been accessed by someone else, or have found something on CarUp that looks like a
            security problem.
          </p>
          <p>
            Forward the message you received where you can, and include the address it came from. Do
            not include your password or any code you were sent — we do not need them, and you should
            not send them to anyone.
          </p>
          <p className="text-slate-600">
            For anything that is not a security concern —a listing, an order, or signing in — write to{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            or see{' '}
            <Link className="font-medium text-orange-700 underline" to="/support">
              CarUp Support
            </Link>
            .
          </p>
        </div>
      </section>

      <section aria-labelledby="phishing" className="mb-10">
        <h2 id="phishing" className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <AlertTriangle className="h-5 w-5 text-orange-700" aria-hidden="true" />
          Recognising a suspicious message
        </h2>
        <ul className="space-y-3 text-sm leading-relaxed text-slate-700">
          <li>
            It creates urgency — an account closing, a payment failing, a listing being removed unless
            you act immediately.
          </li>
          <li>It asks you to confirm a password, a code, or payment details by replying.</li>
          <li>
            The link does not go to <strong className="font-semibold text-slate-900">{CANONICAL_DOMAIN}</strong>.
            Hover or long-press a link to see where it actually leads before you open it.
          </li>
          <li>It asks you to move a CarUp conversation to a different platform to complete a deal.</li>
          <li>
            It asks you to pay someone directly outside a CarUp flow you started yourself.
          </li>
        </ul>
      </section>

      <section aria-labelledby="links" className="mb-10">
        <h2 id="links" className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Link2 className="h-5 w-5 text-orange-700" aria-hidden="true" />
          CarUp links and domains
        </h2>
        <div className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            Pages CarUp asks you to visit are on{' '}
            <strong className="font-semibold text-slate-900">{CANONICAL_DOMAIN}</strong>. If you are
            unsure about a link in a message, do not use it: open{' '}
            <strong className="font-semibold text-slate-900">{CANONICAL_DOMAIN}</strong> yourself and
            sign in there.
          </p>
          <p>
            That is the safest habit for every service, not only CarUp — a link you typed yourself
            cannot be the wrong one.
          </p>
        </div>
      </section>

      <section aria-labelledby="account" className="mb-10">
        <h2 id="account" className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <KeyRound className="h-5 w-5 text-orange-700" aria-hidden="true" />
          Passwords and account recovery
        </h2>
        <ul className="space-y-3 text-sm leading-relaxed text-slate-700">
          <li>
            Use a password you have not used anywhere else. A password reused from another service is
            only as safe as that service was.
          </li>
          <li>
            A CarUp password reset link can be used once and expires. If you did not request one, you
            can ignore it — your current password keeps working until you choose a new one.
          </li>
          <li>
            Start a reset from CarUp yourself when you need one, rather than from a link in a message
            you did not expect.
          </li>
          <li>
            If you think someone else has your password, change it, and tell us at{' '}
            <a className="font-medium text-orange-700 underline" href={`mailto:${SECURITY_EMAIL}`}>
              {SECURITY_EMAIL}
            </a>
            .
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm leading-relaxed text-slate-700">
        <p>
          How CarUp handles your personal information is set out in the{' '}
          <Link className="font-medium text-orange-700 underline" to="/privacy">
            Privacy Policy
          </Link>
          . How CarUp verifies what it publishes about a vehicle is covered in{' '}
          <Link className="font-medium text-orange-700 underline" to="/trust">
            Trust &amp; Safety
          </Link>
          .
        </p>
      </section>
    </main>
  )
}
