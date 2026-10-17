import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Wrench, Loader2 } from 'lucide-react'
import type { VehicleWorkOrder, WorkOrderDecision } from '@/lib/partsentry'
import { refusalMessage } from '@/lib/partsentry'

/**
 * OC-5A — the vehicle custodian decides on the work orders mechanics open on their vehicle.
 *
 * A mechanic can open a work order on any vehicle; until the owner authorizes it here, it grants that
 * mechanic NOTHING — they cannot add to this vehicle's service record or move its odometer. Revoking
 * withdraws that authority, and a revoked work order is final.
 */
const STATE_LABEL: Record<VehicleWorkOrder['owner_authorization'], string> = {
  pending: 'Waiting for your decision',
  authorized: 'Authorized',
  declined: 'Declined',
  revoked: 'Revoked',
}

interface Props {
  vin: string
  fetchVehicleWorkOrders: (vin: string) => Promise<VehicleWorkOrder[]>
  decideWorkOrderAuthorization: (vin: string, workOrderId: string, decision: WorkOrderDecision) => Promise<unknown>
}

export default function WorkOrderRequests({ vin, fetchVehicleWorkOrders, decideWorkOrderAuthorization }: Props) {
  const [orders, setOrders] = useState<VehicleWorkOrder[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)

  // Promise-chain form: every setState lives in a .then/.catch callback, never synchronously in the effect.
  const load = useCallback(() => fetchVehicleWorkOrders(vin)
    .then((rows) => {
      setOrders(Array.isArray(rows) ? rows : [])
      setLoadError(null)
    })
    .catch((err: unknown) => {
      setOrders(null)
      setLoadError(refusalMessage(err, 'Service requests could not be loaded.'))
    }), [vin, fetchVehicleWorkOrders])

  useEffect(() => { void load() }, [load])

  const decide = async (order: VehicleWorkOrder, decision: WorkOrderDecision) => {
    setDeciding(order.id)
    try {
      await decideWorkOrderAuthorization(vin, order.id, decision)
      toast.success(decision === 'authorized'
        ? 'Authorized. This mechanic may now record service on your vehicle.'
        : decision === 'revoked' ? 'Revoked. This mechanic can no longer record service on your vehicle.' : 'Declined.')
      await load()
    } catch (err: unknown) {
      toast.error(refusalMessage(err, 'The decision could not be saved.'))
    } finally {
      setDeciding(null)
    }
  }

  const visible = (orders ?? []).filter((order) => order.owner_authorization === 'pending' || order.owner_authorization === 'authorized')

  return (
    <Card className="border-0 card-shadow" data-testid="work-order-requests">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><Wrench className="w-5 h-5 text-orange-500" /> Service requests</CardTitle>
        <p className="text-sm text-gray-500">A garage can record service on your vehicle only after you authorize its work order.</p>
      </CardHeader>
      <CardContent>
        {loadError && <p className="text-sm text-red-600" role="alert">{loadError}</p>}
        {!loadError && orders === null && <p className="text-sm text-gray-500"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading service requests…</p>}
        {!loadError && orders !== null && visible.length === 0 && (
          <p className="text-sm text-gray-500" data-testid="work-order-requests-empty">No garage has an open request for this vehicle.</p>
        )}
        <ul className="space-y-3">
          {visible.map((order) => (
            <li key={order.id} className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`work-order-${order.id}`}>
              <div className="min-w-0">
                <p className="font-medium text-sm">{order.organisation?.name ?? 'A garage'}{order.mechanic?.name ? ` — ${order.mechanic.name}` : ''}</p>
                {order.description && <p className="text-sm text-gray-600 break-words">{order.description}</p>}
                <Badge variant="outline" className="mt-1 text-[10px]">{STATE_LABEL[order.owner_authorization]}</Badge>
              </div>
              <div className="flex gap-2 shrink-0">
                {order.owner_authorization === 'pending' && (
                  <>
                    <Button size="sm" disabled={deciding === order.id} onClick={() => decide(order, 'authorized')} data-testid={`authorize-${order.id}`}>Authorize</Button>
                    <Button size="sm" variant="outline" disabled={deciding === order.id} onClick={() => decide(order, 'declined')} data-testid={`decline-${order.id}`}>Decline</Button>
                  </>
                )}
                {order.owner_authorization === 'authorized' && (
                  <Button size="sm" variant="outline" disabled={deciding === order.id} onClick={() => decide(order, 'revoked')} data-testid={`revoke-${order.id}`}>Revoke</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
