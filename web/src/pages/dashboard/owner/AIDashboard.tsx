/**
 * Gutu AI — CarUp Intelligence I18.
 *
 * This surface was not an AI. It matched keywords against a fixed lookup table and
 * returned prepared strings after a 1.2-second delay that simulated thinking. The
 * strings asserted specific facts about the reader's OWN property:
 *
 *   - a market valuation for a named vehicle ("$11,800"), with a month-on-month
 *     movement ("3.2% decrease") and a selling range;
 *   - a service history and a due date, quoting a past service date and mileage;
 *   - an insurance policy — insurer, policy number, expiry date and annual
 *     premium — followed by the advice that the premium was "competitive";
 *   - three named garages with star ratings and distances;
 *   - and a fraud-detection rate.
 *
 * None of it came from anywhere. This is the most dangerous fabrication class in
 * the programme: a conversational register invites exactly the trust it cannot
 * bear, and a reader had no way to tell these apart from their real records.
 *
 * What replaces it is the governed context itself. Gutu now shows what CarUp
 * actually holds about you, and — just as prominently — what it does not hold, so
 * the questions it cannot answer are visibly unanswerable rather than answered
 * with an invention.
 */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Bot, CheckCircle2, Info, AlertCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

interface ContextFact {
  key: string
  label: string
  value: number | null
  unit: string | null
  available: boolean
  reason: string | null
  source: string
}

interface ContextPayload {
  ok?: boolean
  availability?: string
  message?: string
  facts?: ContextFact[]
  boundaries?: string[]
}

export default function AIDashboard() {
  const { fetchAssistantContext } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<ContextPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchAssistantContext !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<ContextPayload>
    try {
      pending = Promise.resolve(fetchAssistantContext()) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: ContextPayload) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchAssistantContext])

  const facts = payload?.facts ?? []
  const known = facts.filter((f) => f.available)
  const notHeld = facts.filter((f) => !f.available)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
          <Bot className="w-5 h-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Gutu AI</h1>
          <p className="text-sm text-gray-500">
            Gutu explains what CarUp records about you. It does not estimate, predict or advise on
            anything CarUp has not recorded.
          </p>
        </div>
      </div>

      {state === 'loading' && (
        <Card className="border-0 card-shadow p-5" data-testid="assistant-context-loading">
          <p className="text-sm text-gray-500">Loading your records…</p>
        </Card>
      )}

      {(state === 'failed' || payload?.availability === 'unavailable') && state !== 'loading' && (
        <Card className="border-0 card-shadow p-5" data-testid="assistant-context-unavailable">
          <p className="flex items-start gap-2 text-sm text-gray-600">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span data-testid="assistant-context-message">
              {payload?.message
                || 'Your CarUp records could not be read, so nothing can be shown from them. This is not a report that you have none.'}
            </span>
          </p>
        </Card>
      )}

      {state === 'ready' && payload?.availability !== 'unavailable' && (
        <>
          <Card className="border-0 card-shadow p-5" data-testid="assistant-known">
            <h2 className="text-sm font-semibold text-gray-700">What CarUp records about you</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {known.map((f) => (
                <div key={f.key} data-testid={`assistant-fact-${f.key}`}>
                  <dd className="text-xl font-semibold text-gray-900" data-testid={`assistant-fact-${f.key}-value`}>
                    {f.value}
                  </dd>
                  <dt className="mt-0.5 text-xs text-gray-600">{f.label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t pt-3 text-[11px] text-gray-400">
              Every figure here comes from your own records. Gutu answers from these and nothing else.
            </p>
          </Card>

          {/* As prominent as the facts. A question that cannot be answered must be
              visibly unanswerable rather than answered with an invention. */}
          <Card className="border-0 card-shadow p-5" data-testid="assistant-not-held">
            <h2 className="text-sm font-semibold text-gray-700">What CarUp does not hold</h2>
            <p className="mt-1 text-xs text-gray-500">
              Gutu will not answer these. Each was previously answered with a figure that came from
              nowhere.
            </p>
            <ul className="mt-3 space-y-2">
              {notHeld.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-sm" data-testid={`assistant-missing-${f.key}`}>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-gray-800">{f.label}</span>
                    <span className="block text-xs text-gray-600">{f.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {payload?.boundaries && payload.boundaries.length > 0 && (
            <Card className="border-0 card-shadow p-5" data-testid="assistant-boundaries">
              <h2 className="text-sm font-semibold text-gray-700">The rules Gutu works under</h2>
              <ul className="mt-3 space-y-2">
                {payload.boundaries.map((rule) => (
                  <li key={rule} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
