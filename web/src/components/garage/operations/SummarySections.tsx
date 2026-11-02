import { Link } from 'react-router-dom'
import { STOCK_STATE_LABEL, type OperationsSummary } from '@/lib/garageBusiness'
import { HowCounted, Metric, NotMeasured, RateValue, Section, humanizeKey } from './OperationsParts'

/**
 * The Work, Appointments, Estimates, Parts and "Not measured" sections of the operations view.
 * Every figure here is one the server counted from this garage's own records; nothing is estimated
 * in the browser, and every metric carries the server's own definition.
 */

export function WorkSection({ work }: { work: OperationsSummary['work'] }) {
  const open = work.open_cases
  const completed = work.completed_jobs
  const cycle = work.cycle_time
  const repeat = work.repeat_customers
  return (
    <Section id="work" title="Work">
      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Metric label="Open service cases" definition={open.definition} testId="metric-open-cases">
          <span className="flex flex-wrap gap-x-4 tabular-nums">
            <span>{open.requested} requested</span>
            <span>{open.accepted} accepted</span>
            <span>{open.active} in progress</span>
          </span>
        </Metric>
        <Metric label="Jobs completed in this window" definition={completed.definition} testId="metric-completed-jobs">
          <span className="tabular-nums">{completed.value}</span>
        </Metric>
        <Metric label="Average time from acceptance to completion" definition={cycle.definition} testId="metric-cycle-time">
          {cycle.state === 'measured'
            ? <span>{cycle.average_hours} hours<span className="ml-2 text-sm font-normal text-gray-600">across {cycle.jobs} {cycle.jobs === 1 ? 'job' : 'jobs'}</span></span>
            : <NotMeasured reason={cycle.reason} />}
        </Metric>
        <Metric label="Repeat customers" definition={repeat.state === 'measured' ? repeat.definition : null} testId="metric-repeat-customers">
          {repeat.state === 'measured'
            ? <span>{repeat.repeat} of {repeat.identified} customers</span>
            : <NotMeasured reason={repeat.reason} />}
        </Metric>
      </dl>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div data-testid="work-by-site">
          <h3 className="font-medium">By site</h3>
          {work.by_site.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No service cases are recorded for any site yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {work.by_site.map((s) => (
                <li key={s.branch_id ?? 'no-site'} className="py-2 text-sm flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{s.name || (s.branch_id ? 'Site name not recorded' : 'No site recorded')}</span>
                  <span className="tabular-nums text-gray-700">{s.open} open · {s.completed_in_window} completed in this window</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="work-by-mechanic">
          <h3 className="font-medium">By mechanic</h3>
          <p className="text-xs text-gray-500">Jobs are credited to the mechanic assigned on the job card.</p>
          {work.by_mechanic.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No jobs were completed in this window.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {work.by_mechanic.map((m) => (
                <li key={m.user_id ?? 'unassigned'} className="py-2 text-sm flex flex-wrap justify-between gap-2">
                  <span className="font-medium">
                    {m.name || (m.attribution === 'no_assignment_recorded' ? 'No mechanic assignment recorded' : 'Name not recorded')}
                  </span>
                  <span className="tabular-nums text-gray-700">{m.completed_jobs} completed</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}

export function AppointmentsSection({ appointments }: { appointments: OperationsSummary['appointments'] }) {
  return (
    <Section id="appointments" title="Appointments">
      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Metric label="Upcoming confirmed appointments" definition={appointments.upcoming_confirmed.definition} testId="metric-upcoming-appointments">
          <span className="tabular-nums">{appointments.upcoming_confirmed.value}</span>
        </Metric>
        <Metric label="No-show rate" definition={appointments.no_show_rate.definition} testId="metric-no-show-rate">
          <RateValue metric={appointments.no_show_rate} />
        </Metric>
      </dl>
    </Section>
  )
}

export function EstimatesSection({ estimates }: { estimates: OperationsSummary['estimates'] }) {
  return (
    <Section id="estimates" title="Estimates">
      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Metric label="Estimates sent in this window" definition={estimates.sent_in_window.definition} testId="metric-estimates-sent">
          <span className="tabular-nums">{estimates.sent_in_window.value}</span>
        </Metric>
        <Metric label="Approval rate" definition={estimates.approval_rate.definition} testId="metric-approval-rate">
          <RateValue metric={estimates.approval_rate} />
        </Metric>
      </dl>
    </Section>
  )
}

export function PartsSection({ parts }: { parts: OperationsSummary['parts'] }) {
  const alerts = parts.stock_alerts
  return (
    <Section id="parts" title="Parts">
      <div className="grid gap-8 lg:grid-cols-2">
        <div data-testid="parts-used">
          <h3 className="font-medium">Parts used in this window</h3>
          {parts.used_in_window.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600">No parts were recorded as used on jobs in this window.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-200 border-y border-gray-200">
              {parts.used_in_window.map((u) => (
                <li key={`${u.sku}-${u.part_name}`} className="py-2 text-sm flex flex-wrap justify-between gap-2">
                  <span><span className="font-medium">{u.part_name}</span> <span className="text-xs text-gray-500">SKU {u.sku}</span></span>
                  <span className="tabular-nums text-gray-700">{u.quantity} used</span>
                </li>
              ))}
            </ul>
          )}
          <HowCounted definition={parts.definition} />
        </div>
        <div data-testid="parts-stock-alerts">
          <h3 className="font-medium">Stock alerts</h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-6 text-sm">
            <div className="py-1"><dt className="text-gray-500">{STOCK_STATE_LABEL.out}</dt><dd className="font-semibold tabular-nums" data-testid="alert-out">{alerts.out}</dd></div>
            <div className="py-1"><dt className="text-gray-500">{STOCK_STATE_LABEL.low}</dt><dd className="font-semibold tabular-nums" data-testid="alert-low">{alerts.low}</dd></div>
            <div className="py-1"><dt className="text-gray-500">{STOCK_STATE_LABEL.uncounted}</dt><dd className="font-semibold tabular-nums" data-testid="alert-uncounted">{alerts.uncounted}</dd></div>
            <div className="py-1"><dt className="text-gray-500">{STOCK_STATE_LABEL.unknown}</dt><dd className="font-semibold tabular-nums" data-testid="alert-unknown">{alerts.unknown}</dd></div>
          </dl>
          <p className="text-xs text-gray-500">Out of {alerts.total} parts on record. A part with no reorder level is never reported as low.</p>
          <Link to="/garage/stock" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-orange-600 underline underline-offset-2">Open parts and stock</Link>
        </div>
      </div>
    </Section>
  )
}

export function NotMeasuredSection({ entries }: { entries: OperationsSummary['not_measured'] }) {
  return (
    <Section id="not-measured" title="Not measured" intro="CarUp does not calculate these. Each is listed with the reason, so a missing figure is never mistaken for a low one.">
      {entries.length === 0 ? (
        <p className="text-sm text-gray-600">The server listed no unmeasured figures.</p>
      ) : (
        <dl className="divide-y divide-gray-200 border-y border-gray-200" data-testid="not-measured-list">
          {entries.map((entry) => (
            <div key={entry.key} className="py-3" data-testid="not-measured-entry">
              <dt className="font-medium capitalize">{humanizeKey(entry.key)}</dt>
              <dd className="text-sm text-gray-600 max-w-prose">{entry.reason}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}
