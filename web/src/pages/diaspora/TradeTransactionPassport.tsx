/**
 * Trade OS T4 — the Order & Booking Passport.
 *
 * One operating surface for both origins. A purchase and a shipment are different transactions
 * and are never conflated, but they answer the same questions in the same order, so the reader
 * never has to learn which database this particular transaction came from:
 *
 *   what is this · who is involved · what was agreed · what is being moved · where does it stand ·
 *   what has CarUp got on record · what is still unknown.
 *
 * Everything rendered here is READ from an authority. Nothing is computed into a friendlier
 * number: a null is drawn as "Not recorded", never as 0, an empty string, or a hopeful dash that
 * reads like an answer. DESIGN.md §8.1.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, MessageSquare, Package, Ship } from 'lucide-react'
import { useTradeLogisticsApi, type TransactionPassport, type PassportStageEntry } from '@/hooks/useTradeLogisticsApi'

/** A fact CarUp does not hold. Stated plainly rather than dressed up as a value. */
function Unknown({ children = 'Not recorded' }: { children?: string }) {
  return <span className="text-slate-400">{children}</span>
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-950">{value ?? <Unknown />}</dd>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-950">
        {icon}{title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const place = (p?: { city: string | null; country: string | null }) => {
  const parts = [p?.city, p?.country].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** Human words for a machine state. The reader never sees an enum. */
const STAGE_STATE_COPY: Record<string, string> = {
  DONE: 'Done',
  CURRENT: 'Happening now',
  PENDING: 'Not yet',
  NOT_STARTED: 'Not started',
  NOT_CONNECTED: 'Not connected',
  NOT_RECORDED: 'Not recorded',
}

function LifecycleRail({ stages }: { stages: PassportStageEntry[] }) {
  return (
    <ol className="space-y-0">
      {stages.map((s) => {
        const done = s.state === 'DONE'
        const current = s.state === 'CURRENT'
        return (
          <li key={s.key} className="flex min-w-0 items-start gap-3 py-2">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                done ? 'bg-emerald-500' : current ? 'bg-orange-500 ring-4 ring-orange-100' : 'bg-slate-300'}`}
            />
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${current ? 'font-bold text-slate-950' : done ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                {s.label}
              </p>
              {/* A stage nobody has reached is not a failure — it just has not happened. */}
              <p className="text-xs text-slate-500">{STAGE_STATE_COPY[s.state] || s.state}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function TradeTransactionPassport() {
  const { kind, id } = useParams<{ kind: string; id: string }>()
  const api = useTradeLogisticsApi()
  const navigate = useNavigate()
  const [data, setData] = useState<TransactionPassport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [arranging, setArranging] = useState(false)
  const [arrangeError, setArrangeError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id || (kind !== 'procurement' && kind !== 'logistics')) {
      setError('This is not a transaction CarUp can open.'); setLoading(false); return
    }
    setLoading(true)
    try {
      setData(await api.getTransactionPassport(kind, id)); setError(null)
    } catch (e) {
      // A refusal is a legitimate answer here, not a broken page.
      setError(e instanceof Error ? e.message : 'This transaction could not be opened.')
      setData(null)
    } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- useTradeLogisticsApi() returns a fresh object each render.
  }, [kind, id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical repo data-fetch pattern: load() flips the loading flag before awaiting so the passport never renders a false empty state.
  useEffect(() => { void load() }, [load])

  /**
   * Start shipping for this purchase (§8 — no re-entry of facts).
   *
   * The server already knows the route and the vehicle, so this creates the shipping request from
   * the order rather than handing the buyer a blank form. It is safe to press twice: the database
   * permits one live continuation per order and the service returns the existing one, so a double
   * click, a retry or a refresh all land on the same transaction. The button disables itself for
   * courtesy, never as the concurrency control.
   */
  const arrangeShipping = useCallback(async () => {
    if (!id) return
    setArranging(true); setArrangeError(null)
    try {
      const result = await api.continueToLogistics(id)
      navigate(`/diaspora/transactions/logistics/${result.request.id}`)
    } catch (e) {
      setArrangeError(e instanceof Error ? e.message : 'Shipping could not be started for this purchase.')
    } finally { setArranging(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- useTradeLogisticsApi() returns a fresh object each render.
  }, [id, navigate])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6" data-testid="transaction-passport-loading">
        <Loader2 className="h-5 w-5 animate-spin text-orange-500" aria-hidden="true" />
        <span className="ml-2 text-sm text-slate-600">Opening this transaction…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl p-6" data-testid="transaction-passport-error">
        <div className="border border-amber-300 bg-amber-50 p-5">
          <p className="flex items-center gap-2 font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> This transaction is not available to you
          </p>
          <p className="mt-2 text-sm text-amber-900">{error}</p>
          <Link to="/diaspora/containers?view=mine" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to my transactions
          </Link>
        </div>
      </div>
    )
  }

  const { identity, participants, commercial, booking, documents, lifecycle } = data
  const requester = participants.requester as { user_id: string | null; role: string; withheld?: boolean } | undefined
  const provider = participants.provider as { user_id: string | null; role: string } | null | undefined
  const buyer = participants.buyer as { user_id: string | null; role: string } | undefined
  const supplier = participants.supplier as { user_id: string | null; role: string } | null | undefined

  return (
    <div className="mx-auto min-w-0 max-w-4xl p-4 sm:p-6" data-testid="transaction-passport">
      {/* Identity — stacks below sm so nothing is squeezed to illegibility on a phone. */}
      <div className="border-b-2 border-slate-950 pb-4">
        <p className="font-mono text-xs text-slate-500" data-testid="transaction-reference">{identity.reference}</p>
        <div className="mt-1 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-950">{identity.context}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {place(identity.origin) || 'Origin not recorded'} → {place(identity.destination) || 'Destination not recorded'}
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800"
                  data-testid="transaction-stage">
              {lifecycle.find((s) => s.state === 'CURRENT')?.label || identity.stage}
            </span>
            {/* The passport shows its working: why it believes this is the stage. */}
            <p className="mt-1 max-w-xs text-xs text-slate-500" data-testid="transaction-stage-evidence">{identity.stage_evidence}</p>
          </div>
        </div>

        {identity.continued_from_order && (
          <p className="mt-3 text-xs text-slate-600">
            Shipping the goods from purchase{' '}
            <Link className="font-semibold text-orange-700 hover:underline"
                  to={`/diaspora/transactions/procurement/${identity.continued_from_order.anchor_id}`}>
              {identity.continued_from_order.reference}
            </Link>
          </p>
        )}
        {identity.shipping_continuation && (
          <p className="mt-3 text-xs text-slate-600">
            Shipping arranged under{' '}
            <Link className="font-semibold text-orange-700 hover:underline"
                  to={`/diaspora/transactions/logistics/${identity.shipping_continuation.anchor_id}`}>
              {identity.shipping_continuation.reference}
            </Link>
          </p>
        )}
      </div>

      <Section title="Who is involved">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {buyer && <Fact label={buyer.role} value={buyer.user_id} />}
          {requester && (
            <Fact
              label={requester.role}
              // A withheld identity is stated as withheld. It is not blank, and it is not a bug.
              value={requester.withheld ? <Unknown>Withheld from you</Unknown> : requester.user_id}
            />
          )}
          {supplier ? <Fact label={supplier.role} value={supplier.user_id} /> : null}
          {provider ? <Fact label={provider.role} value={provider.user_id} /> : null}
        </dl>
      </Section>

      <Section title="What was agreed">
        {commercial ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Fact label="Offer" value={commercial.quote_reference} />
            <Fact label="Agreed price" value={
              commercial.total_amount === null ? <Unknown /> : `${commercial.currency || ''} ${commercial.total_amount}`.trim()} />
            <Fact label="Service" value={commercial.service_mode ? commercial.service_mode.replace(/_/g, ' ') : <Unknown />} />
            {commercial.valid_until !== undefined && (
              <Fact label="Offer was valid until" value={commercial.valid_until} />
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-600">
            Nothing has been agreed yet — {data.offers_visible > 0
              ? `${data.offers_visible} offer${data.offers_visible === 1 ? '' : 's'} received and waiting on a decision.`
              : 'no offers have arrived.'}
          </p>
        )}
      </Section>

      {data.cargo && data.cargo.length > 0 && (
        <Section title="What is being moved" icon={<Package className="h-4 w-4 text-orange-500" aria-hidden="true" />}>
          <ul className="divide-y divide-slate-200">
            {data.cargo.map((line) => (
              <li key={line.line_number} className="py-3">
                <p className="font-semibold text-slate-950">{line.description || <Unknown>Cargo not described</Unknown>}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {line.quantity ?? <Unknown />} × ·{' '}
                  {/* Unknown measurements stay unknown. A blank CBM is not zero CBM. */}
                  {line.estimated_volume_cbm !== null ? `${line.estimated_volume_cbm} CBM` : <Unknown>Volume not recorded</Unknown>} ·{' '}
                  {line.estimated_weight_kg !== null ? `${line.estimated_weight_kg} kg` : <Unknown>Weight not recorded</Unknown>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Measurement basis: {line.measurement_basis === 'UNKNOWN' ? 'not established yet' : line.measurement_basis.toLowerCase()}
                  {line.has_linked_vehicle ? ' · linked to a vehicle' : ''}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Shipping and container" icon={<Ship className="h-4 w-4 text-orange-500" aria-hidden="true" />}>
        {booking?.sailing || booking?.reservation ? (
          <div className="space-y-4">
            {booking.sailing && (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Fact label="Sailing" value={booking.sailing.reference} />
                <Fact label="Departs" value={booking.sailing.departure_date} />
                <Fact label="Space left on this sailing"
                      value={`${booking.sailing.capacity.available_cbm} of ${booking.sailing.capacity.total_cbm} CBM`} />
              </dl>
            )}
            {booking.reservation ? (
              <div className="border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-950">
                  {booking.reservation.state === 'APPROVED'
                    ? 'The organiser has approved your space'
                    : 'Space requested — the organiser still has to approve it'}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {booking.reservation.reference} · {booking.reservation.reserved_cbm ?? <Unknown />} CBM
                </p>
                {/* The distinction the whole product rests on, said out loud. */}
                <p className="mt-2 text-xs text-slate-500">
                  {booking.reservation.consumes_capacity
                    ? 'This booking now takes up space on the sailing.'
                    : 'Requesting space does not take up any space yet.'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No container space has been requested for this transaction.</p>
            )}
          </div>
        ) : data.kind === 'procurement' && !identity.shipping_continuation ? (
          <div>
            <p className="text-sm text-slate-600">
              Shipping has not been arranged for this purchase yet.
              {commercial ? ' CarUp already has the route and the vehicle, so you will not be asked for them again.' : ''}
            </p>
            {commercial ? (
              <button
                type="button"
                onClick={() => void arrangeShipping()}
                disabled={arranging}
                data-testid="arrange-shipping"
                className="mt-3 inline-flex items-center gap-2 bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                {arranging ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ship className="h-4 w-4" aria-hidden="true" />}
                {arranging ? 'Starting…' : 'Arrange shipping for this purchase'}
              </button>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Accept a supplier offer first — there is nothing to ship until then.</p>
            )}
            {arrangeError && <p className="mt-2 text-sm text-amber-800" data-testid="arrange-shipping-error">{arrangeError}</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-600">No sailing has been attached to this transaction.</p>
        )}
      </Section>

      <Section title="Where it stands">
        <LifecycleRail stages={lifecycle} />
      </Section>

      <Section title="Documents">
        {!documents.authority_available ? (
          // Saying "no documents" would claim knowledge we do not have.
          <p className="text-sm text-slate-600" data-testid="documents-unknown">
            {documents.note || 'No document record is connected to this transaction yet.'}
          </p>
        ) : documents.records.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing has been filed against this transaction yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {documents.records.map((doc) => (
              <li key={doc.id} className="flex min-w-0 items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-800">{doc.document_type || <Unknown />}</span>
                <span className="shrink-0 text-xs text-slate-500">{doc.verification_status || <Unknown>Not reviewed</Unknown>}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Messages" icon={<MessageSquare className="h-4 w-4 text-orange-500" aria-hidden="true" />}>
        <p className="text-sm text-slate-600">
          Messages about this transaction stay in the conversation CarUp already keeps for it.
        </p>
      </Section>
    </div>
  )
}
