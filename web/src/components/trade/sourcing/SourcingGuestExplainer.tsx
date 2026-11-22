/**
 * LR02 — /diaspora/rfq for a signed-out visitor: how sourcing requests work, before any account.
 * Static. It reads nothing (the page container makes no request for a guest) and offers two real actions:
 * prepare a request (public to start) and sign in to see your own requests (a safe login redirect).
 *
 * Every statement was checked against the backend:
 *  - a request reaches sellers only once published (diasporaRfqService.listRfqs keeps metadata.rfq.published);
 *  - sellers who can quote receive the published request as recorded, budget included when one was entered
 *    (GET /diaspora/rfqs returns the request row) — so this page never claims the budget is hidden;
 *  - a quote is what a seller submits (amount, currency, terms); CarUp computes nothing;
 *  - accepting needs a signed-in buyer, takes only a submitted quote and rejects the other submitted quotes
 *    on that request in the same step (diaspora_accept_quote_atomic); a request with an accepted quote
 *    leaves the sellers' list.
 * Rendered in the public chrome (guests never get the Trade workspace), so it carries its own page gutter.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Eye, LogIn, PenLine, Scale, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WS_PRIMARY, WS_SECONDARY, WS_TEXT_ACTION } from '@/components/dealer/workspace/workspaceStyles'
import { buildLoginRedirect } from '@/lib/returnTo'
import { sampleJourneyHref } from '@/content/trade/sampleJourneyLinks'
import { DeskHeader, DeskPanel } from './TradeDesk'

const STEPS = [
  { key: 'describe', icon: PenLine, title: 'You describe what you want', body: 'The vehicle or parts, the years, where it should come from, where it should arrive and your budget. You can prepare this without an account; sending it needs one.' },
  { key: 'publish', icon: Send, title: 'You publish it', body: 'Sellers cannot see a request until you publish it. Once it is published, sellers who can quote see it.' },
  { key: 'quote', icon: Scale, title: 'Sellers quote', body: 'A quote is only what a seller submits: an amount, its currency and any terms they add. CarUp adds no freight, duty or fees, converts no currency and never makes a quote up.' },
  { key: 'choose', icon: CheckCircle2, title: 'You choose', body: 'You compare the quotes and accept the one you want — only when you are signed in, and only a quote a seller actually submitted. Accepting one rejects the other submitted quotes on that request.' },
] as const

export function SourcingGuestExplainer() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8 lg:px-8" data-testid="trade-rfq-guest">
      <DeskHeader
        eyebrow="Trade · Sourcing"
        title="Sourcing requests"
        description="Ask sellers for the vehicle or parts you want and compare what they quote — the reverse of searching listings. Read how it works and prepare a request without an account."
        actions={(
          <>
            {/* Phones: one full-width action per row (min-width wins over the header's flex-1 children). */}
            <Link to="/diaspora/imports/new" className={cn(WS_PRIMARY, 'min-w-full text-center sm:min-w-0')} data-testid="trade-rfq-guest-prepare">
              Prepare a request — no account needed to start <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
            <Link to={buildLoginRedirect('/diaspora/rfq')} className={cn(WS_SECONDARY, 'min-w-full text-center sm:min-w-0')} data-testid="trade-rfq-guest-signin">
              <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />Sign in to see your requests
            </Link>
          </>
        )}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <DeskPanel title="How a sourcing request works" eyebrow="A request in reverse" testId="trade-rfq-guest-steps">
          <ol className="space-y-4">
            {STEPS.map(({ key, icon: Icon, title, body }, i) => (
              <li key={key} className="flex gap-3" data-testid={`trade-rfq-guest-step-${key}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-carup-bg-surface text-carup-text-2" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-carup-text"><span className="sr-only">Step {i + 1}: </span>{title}</h3>
                  <p className="mt-0.5 text-sm leading-6 text-carup-text-2">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link to={sampleJourneyHref('request', 'quotes')} className={cn(WS_TEXT_ACTION, 'mt-3')} data-testid="trade-rfq-guest-sample">
            See how quotes look in a sample import <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </DeskPanel>

        <div className="min-w-0 space-y-5">
          <DeskPanel title="What sellers see" testId="trade-rfq-guest-sellers-see">
            <ul className="space-y-2.5 text-sm leading-6 text-carup-text-2">
              <li className="flex gap-2.5"><Eye className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />Sellers who can quote see a published request with everything in it: what you want, the years, the route and the budget you stated.</li>
              <li className="flex gap-2.5"><Eye className="mt-1 h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />They never see a request you have not published, and a request leaves their list once you accept a quote.</li>
            </ul>
          </DeskPanel>
          <DeskPanel title="What needs an account" testId="trade-rfq-guest-account">
            <p className="text-sm leading-6 text-carup-text-2">Sending a request, publishing it, seeing the quotes on it and accepting one all happen signed in, because they belong to your account. Nothing here was loaded or saved.</p>
          </DeskPanel>
        </div>
      </div>
    </div>
  )
}
