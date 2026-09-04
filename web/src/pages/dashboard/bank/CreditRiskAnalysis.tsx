/**
 * Credit risk — CarUp Intelligence I11.
 *
 * This page did the one thing the programme's Trust rules most clearly forbid: it
 * converted a CarUp Trust score directly into a borrower credit grade, banding
 * applications into "A (Super Trust)", "B (High Trust)", "C (Medium Trust)" and
 * "D (Low Trust)" by score thresholds.
 *
 * Trust is a statement about EVIDENCE — how much confidence CarUp places in what
 * is known about a VEHICLE. It is not a statement about a PERSON's willingness or
 * ability to repay, and the two are not related by any model CarUp owns. Re-badging
 * one as the other would let a vehicle with thin paperwork read as a poor credit
 * risk, and a well-documented vehicle as a good one, regardless of the borrower.
 *
 * The rest of the page was fabricated in the ordinary way: the grade distribution
 * and a portfolio value were hardcoded as initial state and shown before any fetch,
 * persisting silently whenever the fetch failed; "AI Credit Model Factors" published
 * weights (35/25/20/20%) for a model that does not exist; non-performing loans were
 * reported as a fixed 0.00% with a "Healthy" badge; and escrow coverage was drawn as
 * a permanently full bar.
 *
 * The portfolio value was computed by summing `requested_amount` across
 * applications — reporting what borrowers ASKED for as money the lender holds.
 *
 * None of it is replaced with an estimate, because CarUp records no lender
 * decision, no disbursement and no repayment. The page states that.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Info } from 'lucide-react'
import { Link } from 'react-router-dom'

const NOT_AVAILABLE = [
  {
    key: 'credit_grading',
    label: 'Borrower credit grading',
    detail:
      'CarUp operates no credit model. Trust states confidence in evidence about a vehicle, not a borrower\'s ability to repay, so it is not converted into a credit grade or a risk tier.',
  },
  {
    key: 'portfolio_value',
    label: 'Portfolio value',
    detail:
      'CarUp records no disbursement, so there is no portfolio. The figure previously shown summed the amounts borrowers requested on applications, which is not money lent.',
  },
  {
    key: 'credit_model_factors',
    label: 'Credit model factors',
    detail:
      'No governed finance model owns any scoring weights, so none are published here.',
  },
  {
    key: 'non_performing',
    label: 'Non-performing loans',
    detail:
      'CarUp records no repayment, arrears or default state, so a delinquency rate cannot be derived. The fixed rate shown here previously asserted a healthy book rather than an unmeasured one.',
  },
  {
    key: 'escrow_coverage',
    label: 'Escrow coverage',
    detail:
      'No escrow arrangement is bound to a finance application, so coverage cannot be computed.',
  },
]

export default function CreditRiskAnalysis() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-gray-400" />
          Credit risk
        </h1>
        <p className="text-gray-500">
          The governed credit domain, kept separate from commercial demand.
        </p>
      </div>

      <Card className="border-0 card-shadow" data-testid="credit-risk-unavailable">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Not available</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            CarUp does not hold the records this domain would need. Nothing below is zero — it is
            unmeasured.
          </p>
          <ul className="space-y-3">
            {NOT_AVAILABLE.map((item) => (
              <li key={item.key} className="flex items-start gap-2" data-testid={`credit-unavailable-${item.key}`}>
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{item.label}</span>
                  <span className="block text-xs text-gray-600">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">What is available</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600">
          <p>
            The applications CarUp has actually received are listed under{' '}
            <Link to="/bank/applications" className="text-blue-600 underline">Applications</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
