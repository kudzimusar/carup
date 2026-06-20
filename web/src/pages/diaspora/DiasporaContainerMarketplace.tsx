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
  const role = (user?.role || '').toLowerCase()
  const canView = isAuthenticated && allowedRoles.has(role)
  const isReviewer = reviewerRoles.has(role)

  const [containers, setContainers] = useState<DiasporaMarketplaceContainer[]>([])
  const [selected, setSelected] = useState<DiasporaMarketplaceContainer | null>(null)
  const [reservations, setReservations] = useState<DiasporaMarketplaceReservation[]>([])
  const [volume, setVolume] = useState('')
  const [error, setError] = useState('')
  const [reserveError, setReserveError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setError('')
    try {
      setContainers(await api.fetchDiasporaMarketplaceContainers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load containers')
    } finally {
      setLoading(false)
    }
  }, [api, canView])

  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, load])

  const open = async (container: DiasporaMarketplaceContainer) => {
    setSelected(container)
    setReserveError('')
    try { setReservations(await api.fetchDiasporaContainerReservations(container.id)) } catch { setReservations([]) }
  }

  const refreshSelected = async () => {
    if (!selected) return
    const cap = await api.fetchDiasporaContainerCapacity(selected.id)
    setSelected(cap.container)
    setReservations(await api.fetchDiasporaContainerReservations(selected.id))
    await load()
  }

  const handleReserve = async () => {
    if (!selected) return
    setReserveError('')
    const v = Number(volume)
    if (!(v > 0)) { setReserveError('Enter a positive volume'); return }
    try {
      await api.requestDiasporaReservation(selected.id, { estimated_volume: v, source: 'ui' })
      setVolume('')
      await refreshSelected()
    } catch (err) {
      setReserveError(err instanceof Error ? err.message : 'Reservation rejected')
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setReserveError('')
    try { await fn(); await refreshSelected() } catch (err) { setReserveError(err instanceof Error ? err.message : 'Action failed') }
  }

  const selFill = useMemo(() => (selected ? fillOf(selected) : null), [selected])

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
                      <TableRow><TableCell colSpan={isReviewer ? 3 : 2} className="h-12 text-center text-gray-500">No reservations.</TableCell></TableRow>
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
