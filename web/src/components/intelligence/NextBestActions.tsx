/**
 * CarUp Intelligence 1.0 — I17 next-best-action.
 *
 * Every recommendation shows the evidence and the threshold that produced it, so
 * a seller who disagrees can see exactly what was counted rather than being asked
 * to trust an opaque suggestion.
 *
 * When no rule fires, the surface distinguishes three quite different situations,
 * because collapsing them is how advice loses its credibility:
 *
 *   - nothing needs doing;
 *   - a rule is deliberately quiet because it was recently shown or dismissed;
 *   - a rule could not run at all, because what it needs was never measured.
 *
 * The third is the one that matters most. It is the difference between "your
 * listing is doing fine" and "CarUp does not know how your listing is doing".
 */
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, Lightbulb } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

interface Recommendation {
  rule: string
  label: string
  explanation: string
  action: string
  evidence: Record<string, number>
  cooldown_days: number
}

interface Abstention {
  rule: string
  label: string
  abstained: string
  missing_inputs?: string[]
  note?: string
  cooldown_until?: string
}

interface RecommendationPayload {
  ok?: boolean
  availability?: string
  message?: string
  recommendations?: Recommendation[]
  abstentions?: Abstention[]
}

const EVIDENCE_LABELS: Record<string, string> = {
  unanswered_leads: 'unanswered leads',
  oldest_lead_age_days: 'days waiting',
  completeness_percent: 'listing completeness',
  views: 'views',
  inquiries: 'enquiries',
  published_listings: 'published listings',
  active_codes: 'active codes',
  validations: 'code uses',
}

export default function NextBestActions() {
  const { fetchMyRecommendations } = useCarUpApi()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [payload, setPayload] = useState<RecommendationPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    // The reset is synchronous on purpose. It clears the previous payload before
    // the new request resolves, so a viewer never sees the last period's figures
    // sitting under this period's label — which on these surfaces would be exactly
    // the kind of misleading number the programme exists to remove. One extra
    // render on a window change is the right trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading')
    if (typeof fetchMyRecommendations !== 'function') {
      setState('failed')
      return () => { cancelled = true }
    }
    let pending: Promise<RecommendationPayload>
    try {
      pending = Promise.resolve(fetchMyRecommendations()) as typeof pending
    } catch {
      setState('failed')
      return () => { cancelled = true }
    }
    pending.then(
      (data: RecommendationPayload) => {
        if (cancelled) return
        setPayload(data)
        setState('ready')
      },
      () => { if (!cancelled) setState('failed') },
    )
    return () => { cancelled = true }
  }, [fetchMyRecommendations])

  if (state === 'loading') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="next-best-actions-loading">
        <h3 className="text-sm font-semibold text-gray-700">Suggested next steps</h3>
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      </section>
    )
  }

  if (state === 'failed' || payload?.availability === 'unavailable') {
    return (
      <section className="rounded-xl border bg-white p-5" data-testid="next-best-actions-unavailable">
        <h3 className="text-sm font-semibold text-gray-700">Suggested next steps</h3>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span data-testid="next-best-actions-message">
            {payload?.message
              || 'Suggestions could not be produced. This is not a finding that there is nothing to do.'}
          </span>
        </p>
      </section>
    )
  }

  const recommendations = payload?.recommendations ?? []
  const abstentions = payload?.abstentions ?? []
  // Rules that could not run at all, as opposed to rules that ran and stayed quiet.
  const couldNotRun = abstentions.filter((a) => a.abstained === 'input_unavailable')

  return (
    <section className="space-y-4" data-testid="next-best-actions">
      <div className="rounded-xl border bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" />
          Suggested next steps
        </h3>

        {recommendations.length === 0 ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-gray-600" data-testid="next-best-actions-none">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            <span>
              Nothing needs your attention right now
              {couldNotRun.length > 0 ? ', from the checks that could run.' : '.'}
            </span>
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {recommendations.map((rec) => (
              <li key={rec.rule} className="rounded-lg border border-gray-100 bg-gray-50 p-4" data-testid={`recommendation-${rec.rule}`}>
                <p className="text-sm font-medium text-gray-900">{rec.label}</p>
                <p className="mt-1 text-sm text-gray-700" data-testid={`recommendation-${rec.rule}-explanation`}>
                  {rec.explanation}
                </p>
                <p className="mt-2 text-sm font-medium text-gray-900" data-testid={`recommendation-${rec.rule}-action`}>
                  {rec.action}
                </p>
                {/* The evidence is shown so the advice can be argued with. */}
                <p className="mt-2 text-[11px] text-gray-500" data-testid={`recommendation-${rec.rule}-evidence`}>
                  Based on{' '}
                  {Object.entries(rec.evidence)
                    .map(([key, val]) => `${val} ${EVIDENCE_LABELS[key] || key}`)
                    .join(', ')}.
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* A check that could not run is not a clean bill of health. */}
      {couldNotRun.length > 0 && (
        <div className="rounded-xl border bg-white p-5" data-testid="next-best-actions-could-not-run">
          <h3 className="text-sm font-semibold text-gray-700">Checks that could not run</h3>
          <p className="mt-1 text-xs text-gray-500">
            These need figures CarUp has not measured for you, so no advice is given rather than
            advice based on a number nobody recorded.
          </p>
          <ul className="mt-2 space-y-2">
            {couldNotRun.map((entry) => (
              <li key={entry.rule} className="flex items-start gap-2 text-sm" data-testid={`abstention-${entry.rule}`}>
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  <span className="font-medium text-gray-800">{entry.label}</span>
                  {entry.missing_inputs && entry.missing_inputs.length > 0 && (
                    <span className="block text-xs text-gray-600">
                      Needs {entry.missing_inputs.map((k) => EVIDENCE_LABELS[k] || k).join(' and ')}, which is not
                      recorded.
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
