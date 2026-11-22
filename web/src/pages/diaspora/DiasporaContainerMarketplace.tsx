import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Container, Loader2, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaMarketplaceContainer, DiasporaMarketplaceReservation } from '@/types'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { ContainerBoardView } from '@/components/trade/sourcing/ContainerBoardView'
import { READ_IDLE, READ_READY, failedRead, type ReadState } from '@/components/trade/sourcing/deskKit'
import { formatCbm, type ContainerNotice } from '@/components/trade/sourcing/containerBoard'

const allowedRoles = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const reviewerRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])

function fillOf(container: DiasporaMarketplaceContainer) {
  const total = Number(container.total_capacity_volume || 0)
  const used = Number(container.used_capacity_volume || 0)
  const pct = total > 0 ? used / total : 0
  return { total, used, available: Math.max(total - used, 0), pct, readyToClose: pct >= 0.9, full: pct >= 0.98 }
}

export default function DiasporaContainerMarketplace() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  // The mount read must be keyed on the individually memoized request function, never on `api`:
  // useCarUpApi() returns a NEW object on every render and owns loading state, so a callback keyed on
  // it re-fired the mount effect on its own state changes — an unbounded request loop (the defect
  // pull request 130 fixed on the trade profile). This identity is stable per signed-in session.
  const { fetchDiasporaMarketplaceContainers } = api
  const role = (user?.role || '').toLowerCase()
  const canView = isAuthenticated && allowedRoles.has(role)
  const isReviewer = reviewerRoles.has(role)

  const [containers, setContainers] = useState<DiasporaMarketplaceContainer[]>([])
  const [selected, setSelected] = useState<DiasporaMarketplaceContainer | null>(null)
  const [reservations, setReservations] = useState<DiasporaMarketplaceReservation[]>([])
  const [reservationsUnreadable, setReservationsUnreadable] = useState(false)
  const [volume, setVolume] = useState('')
  const [error, setError] = useState('')
  const [reserveError, setReserveError] = useState('')
  const [loading, setLoading] = useState(false)
  // RX-06 unified view only (the legacy view never reads these): whether the list read has answered
  // and how, whose reservations the list holds, and a receipt/refusal for the last action.
  const [listRead, setListRead] = useState<ReadState>(READ_IDLE)
  const [reservationsFor, setReservationsFor] = useState<string | null>(null)
  const [boardNotice, setBoardNotice] = useState<ContainerNotice | null>(null)

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setError('')
    try {
      setContainers(await fetchDiasporaMarketplaceContainers())
      setListRead(READ_READY)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load containers')
      setListRead(failedRead(err))
    } finally {
      setLoading(false)
    }
  }, [fetchDiasporaMarketplaceContainers, canView])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, load])

  const open = async (container: DiasporaMarketplaceContainer) => {
    setSelected(container)
    setReserveError('')
    setBoardNotice(null)
    try {
      setReservations(await api.fetchDiasporaContainerReservations(container.id))
      setReservationsUnreadable(false)
      setReservationsFor(container.id)
    } catch {
      // A reviewer could otherwise close a booking believing nobody reserved space.
      setReservations([])
      setReservationsUnreadable(true)
      setReservationsFor(container.id)
    }
  }

  const refreshSelected = async () => {
    if (!selected) return
    const cap = await api.fetchDiasporaContainerCapacity(selected.id)
    setSelected(cap.container)
    setReservations(await api.fetchDiasporaContainerReservations(selected.id))
    setReservationsUnreadable(false)
    setReservationsFor(selected.id)
    await load()
  }

  const handleReserve = async () => {
    if (!selected) return
    setReserveError('')
    setBoardNotice(null)
    const v = Number(volume)
    if (!(v > 0)) {
      setReserveError('Enter a positive volume')
      setBoardNotice({ tone: 'danger', text: 'Enter the space you need in CBM — a number greater than zero.' })
      return
    }
    // RX06-LR03 (TF-69): the request's outcome comes from the POST alone. A failed re-read afterwards
    // does not mean the request failed — it was recorded — so it is reported as a stale board instead.
    try {
      await api.requestDiasporaReservation(selected.id, { estimated_volume: v, source: 'ui' })
    } catch (err) {
      setReserveError(err instanceof Error ? err.message : 'Reservation rejected')
      setBoardNotice({ tone: 'danger', text: `Not requested: ${err instanceof Error ? err.message : 'Reservation rejected'}` })
      return
    }
    setVolume('')
    const requested = `Space requested: ${formatCbm(v)}. It counts against capacity only once a CarUp logistics reviewer approves it.`
    setBoardNotice({ tone: 'info', text: requested })
    try {
      await refreshSelected()
    } catch {
      setBoardNotice({ tone: 'info', text: `${requested} The board could not be refreshed — reload to see the latest capacity.` })
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setReserveError('')
    setBoardNotice(null)
    // RX06-LR03 (TF-73): a recorded decision stays reported as recorded even if the re-read fails.
    try { await fn() } catch (err) {
      setReserveError(err instanceof Error ? err.message : 'Action failed')
      setBoardNotice({ tone: 'danger', text: err instanceof Error ? err.message : 'Action failed' })
      return
    }
    try { await refreshSelected() } catch {
      setBoardNotice(prev => ({ tone: 'info', text: `${prev?.text ?? 'Recorded.'} The board could not be refreshed — reload to see the latest state.` }))
    }
  }

  const selFill = useMemo(() => (selected ? fillOf(selected) : null), [selected])

  if (isUnifiedUiEnabled()) {
    // RX-06: the same reads, state and handlers, arranged as a "space on a ship" board.
    return (
      <ContainerBoardView
        model={{
          authLoading,
          signedIn: isAuthenticated,
          role,
          canView,
          isReviewer,
          containers,
          read: listRead,
          loading,
          onRetry: () => { void load() },
          selected,
          onOpen: open,
          reservations,
          reservationsFor,
          reservationsUnreadable,
          volume,
          setVolume,
          onReserve: handleReserve,
          onApprove: (id) => act(async () => {
            await api.approveDiasporaMarketplaceReservation(id)
            setBoardNotice({ tone: 'info', text: 'Space request approved. It now counts against the container’s capacity.' })
          }),
          onReject: (id) => act(async () => {
            await api.rejectDiasporaMarketplaceReservation(id)
            setBoardNotice({ tone: 'info', text: 'Space request rejected.' })
          }),
          onCloseBooking: () => act(async () => {
            if (!selected) return
            await api.closeDiasporaContainerBooking(selected.id)
            setBoardNotice({ tone: 'info', text: 'Booking closed. No new space can be requested on this container.' })
          }),
          notice: boardNotice,
        }}
      />
    )
  }

  if (authLoading) return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-container-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The container marketplace requires an authorized trade role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-container-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950"><Container className="h-6 w-6 text-orange-600" /> Container co-loading</h1>
          <p className="mt-1 text-sm text-gray-500">Shared container capacity. Overfill is rejected server-side even if the form allows a request.</p>
        </div>
        <Button asChild variant="outline"><Link to="/diaspora/rfq">Reverse RFQ</Link></Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-950">Open containers</h2>
          {loading && <p className="mt-3 flex items-center gap-2 text-sm text-orange-700" data-testid="diaspora-container-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {error && <Alert className="mt-3 border-red-200 bg-red-50" data-testid="diaspora-container-error"><AlertTriangle className="h-4 w-4 text-red-700" /><AlertDescription>{error}</AlertDescription></Alert>}
          {!loading && !error && containers.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-container-empty">No open containers.</p>}
          <div className="mt-3 space-y-3">
            {containers.map((c) => {
              const f = fillOf(c)
              return (
                <div key={c.id} className="rounded-md border border-gray-200 p-4" data-testid="diaspora-container-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-950">{c.origin_country} → {c.destination_country}</p>
                      <p className="text-xs text-gray-500">{c.container_type} · departs {c.departure_date ? String(c.departure_date).slice(0, 10) : 'TBD'}</p>
                    </div>
                    <Badge variant="outline" data-testid="diaspora-container-status">{c.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    Used {f.used} / {f.total} CBM · available {f.available} · <span data-testid="diaspora-container-fill">{(f.pct * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    {f.readyToClose && !f.full && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid="diaspora-container-ready-to-close">Ready to close</Badge>}
                    {f.full && <Badge className="bg-red-100 text-red-800 hover:bg-red-100" data-testid="diaspora-container-full">Full</Badge>}
                  </div>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => open(c)} data-testid="diaspora-container-open">Open</Button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-md border border-gray-200 bg-white p-5">
          {selected ? (
            <div data-testid="diaspora-container-detail">
              <h2 className="text-lg font-semibold text-gray-950">{selected.origin_country} → {selected.destination_country}</h2>
              {selFill && (
                <p className="mt-1 text-sm text-gray-600">
                  Used {selFill.used}/{selFill.total} CBM · available {selFill.available} · {(selFill.pct * 100).toFixed(0)}%
                </p>
              )}

              <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3">
                <p className="text-sm font-medium text-orange-900">Request cargo space</p>
                <div className="mt-2 flex items-center gap-2">
                  <Input type="number" min="0" placeholder="Volume (CBM)" value={volume} onChange={(e) => setVolume(e.target.value)} className="w-40" data-testid="diaspora-container-reserve-volume" />
                  <Button onClick={handleReserve} data-testid="diaspora-container-reserve-submit">Request</Button>
                </div>
                {reserveError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>}
              </div>

              <h3 className="mt-4 text-base font-semibold text-gray-950">Reservations</h3>
              <div className="mt-2 rounded-md border border-gray-200" data-testid="diaspora-container-reservations">
                <Table>
                  <TableHeader><TableRow><TableHead>Volume</TableHead><TableHead>Status</TableHead>{isReviewer && <TableHead>Action</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {reservations.length === 0 ? (
                      <TableRow><TableCell colSpan={isReviewer ? 3 : 2} className="h-12 text-center text-gray-500" data-testid="container-reservations-state">
                    {reservationsUnreadable
                      ? 'Reservations could not be loaded. This is not a report that none exist.'
                      : 'No reservations.'}
                  </TableCell></TableRow>
                    ) : reservations.map((r) => (
                      <TableRow key={r.id} data-testid="diaspora-container-reservation-row">
                        <TableCell>{r.estimated_volume} CBM</TableCell>
                        <TableCell><Badge variant="outline">{r.reservation_status}</Badge></TableCell>
                        {isReviewer && (
                          <TableCell className="space-x-1">
                            {r.reservation_status === 'REQUESTED' && (
                              <>
                                <Button size="sm" onClick={() => act(() => api.approveDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-approve">Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => act(() => api.rejectDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-reject">Reject</Button>
                              </>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {isReviewer && selected.status === 'BOOKING_OPEN' && (
                <Button variant="secondary" className="mt-3" onClick={() => act(() => api.closeDiasporaContainerBooking(selected.id))} data-testid="diaspora-container-close-booking">Close booking</Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500" data-testid="diaspora-container-detail-empty">Select a container to request space.</p>
          )}
        </section>
      </div>
    </div>
  )
}
