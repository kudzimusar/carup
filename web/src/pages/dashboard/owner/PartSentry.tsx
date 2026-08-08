import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Shield, Search, Wrench, FileText, Loader2, Copy, CheckCircle2 } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

// Matches the DB CHECK constraint on partsentry_logs.action_type.
const ACTION_TYPES = ['Replaced', 'Repaired', 'Inspected', 'Diagnosed'] as const

// Row shape returned by GET /api/partsentry/:vin
interface RepairLogRow {
  id: string | number
  vin: string
  part_name: string
  part_oem?: string
  action_type: string
  mileage: number
  timestamp: string
  verification_status?: string
}

export default function PartSentry() {
  const { addRepairLog, verifyLedger, fetchOwnedVehicles, fetchRepairHistory } = useCarUpApi()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [repairLogs, setRepairLogs] = useState<RepairLogRow[]>([])
  // Loading is derived (selected vehicle vs last loaded) so the load path never
  // has to set state synchronously inside the effect.
  const [loadedHistoryVin, setLoadedHistoryVin] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [ledgerVerified, setLedgerVerified] = useState<boolean | null>(null)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [copiedHash, setCopiedHash] = useState<string | null>(null)
  const [repairForm, setRepairForm] = useState({
    vin: '',
    partName: '',
    actionType: 'Replaced',
    description: '',
    mileage: '',
    partOem: '',
  })

  useEffect(() => {
    fetchOwnedVehicles().then(data => {
      setVehicles(data)
      if (data.length > 0) {
        setSelectedVehicle(data[0].vin)
        setRepairForm(f => ({ ...f, vin: data[0].vin }))
      }
    }).catch(() => setVehicles([]))
  }, [fetchOwnedVehicles])

  // Promise-chain form: every setState lives in a .then/.catch/.finally callback
  // so the effect that invokes this never sets state synchronously.
  const loadHistory = useCallback((vin: string) => {
    return fetchRepairHistory(vin)
      .then(rows => {
        setRepairLogs(Array.isArray(rows) ? rows : [])
        setHistoryError(null)
      })
      .catch((err: unknown) => {
        setRepairLogs([])
        setHistoryError(err instanceof Error ? err.message : 'Failed to load repair history')
      })
      .finally(() => setLoadedHistoryVin(vin))
  }, [fetchRepairHistory])
  const historyLoading = Boolean(selectedVehicle) && loadedHistoryVin !== selectedVehicle

  // Real repair history + ledger verification for the selected vehicle.
  useEffect(() => {
    if (!selectedVehicle) return
    loadHistory(selectedVehicle)
    verifyLedger(selectedVehicle)
      .then(data => {
        setLedgerVerified(data?.integrity === 'verified' || data?.verified === true)
        setLedgerError(null)
      })
      .catch((err: unknown) => {
        // A failed verification is an error, never a fake "verified".
        setLedgerVerified(null)
        setLedgerError(err instanceof Error ? err.message : 'Ledger verification unavailable')
      })
  }, [selectedVehicle, verifyLedger, loadHistory])

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).catch(() => {})
    setCopiedHash(hash)
    setTimeout(() => setCopiedHash(null), 2000)
    toast.success('Hash copied!')
  }

  const handleAddRepair = async () => {
    if (!repairForm.partName || !repairForm.actionType) {
      toast.error('Part name and action type are required')
      return
    }
    setSubmitting(true)
    try {
      // Mechanic identity is derived server-side from the authenticated user.
      const result = await addRepairLog(
        repairForm.vin,
        repairForm.partName,
        repairForm.partOem || 'UNKNOWN',
        repairForm.actionType,
        repairForm.description || 'Service performed',
        parseInt(repairForm.mileage) || 0,
      )
      if (!result?.id) {
        toast.error('The server did not confirm the repair was recorded')
        return
      }
      toast.success(`Repair log #${result.id} recorded on the PartSentry ledger${result.signature ? ` (signature ${result.signature})` : ''}`, { duration: 5000 })
      setShowAddDialog(false)
      setRepairForm({ vin: repairForm.vin, partName: '', actionType: 'Replaced', description: '', mileage: '', partOem: '' })
      if (repairForm.vin === selectedVehicle) {
        await loadHistory(selectedVehicle)
      }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      if (status === 403) {
        toast.error('You are not authorized to log repairs for this vehicle. Only the vehicle owner, an authorized dealer or a certified mechanic can write to its ledger.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to record the repair')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const lastService = repairLogs.length > 0 ? new Date(repairLogs[0].timestamp).toLocaleDateString() : '—'

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">PartSentry</h1>
            <Badge className="bg-purple-500 text-white text-[10px]">BETA</Badge>
            {ledgerVerified !== null && (
              <Badge className={`text-[10px] ${ledgerVerified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {ledgerVerified ? '🔒 Ledger Verified' : '⚠️ Tampered'}
              </Badge>
            )}
            {ledgerError && (
              <Badge className="text-[10px] bg-gray-100 text-gray-600">Verification unavailable</Badge>
            )}
          </div>
          <p className="text-gray-500">Blockchain-backed parts lifecycle tracking</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4" /> Log New Repair
        </Button>
      </div>

      {/* Vehicle Selector */}
      <div className="flex flex-wrap gap-2">
        {vehicles.map(v => (
          <button key={v.vin} onClick={() => {
              setSelectedVehicle(v.vin)
              setRepairForm(f => ({ ...f, vin: v.vin }))
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedVehicle === v.vin ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v.make} {v.model}
          </button>
        ))}
      </div>

      {/* Stats — derived from the real ledger rows only */}
      <div className="grid sm:grid-cols-4 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Logged Repairs</p><p className="text-2xl font-bold">{repairLogs.length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Parts Replaced</p><p className="text-2xl font-bold text-green-600">{repairLogs.filter(r => r.action_type === 'Replaced').length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Inspections</p><p className="text-2xl font-bold text-orange-600">{repairLogs.filter(r => r.action_type === 'Inspected' || r.action_type === 'Diagnosed').length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Last Service</p><p className="text-2xl font-bold text-purple-600">{lastService}</p></CardContent></Card>
      </div>

      {/* Parts Ledger */}
      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-500" /> Parts Ledger
            {historyLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyError ? (
            <div className="text-center py-12" data-testid="parts-ledger-error">
              <Wrench className="w-12 h-12 text-red-200 mx-auto mb-3" />
              <p className="text-red-600 font-medium">Could not load the repair history for this vehicle.</p>
              <p className="text-gray-500 text-sm mt-1">{historyError}</p>
              <Button variant="outline" className="mt-4" onClick={() => selectedVehicle && loadHistory(selectedVehicle)}>Retry</Button>
            </div>
          ) : repairLogs.length === 0 ? (
            <div className="text-center py-12" data-testid="parts-ledger-empty">
              <Wrench className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500">No repair history found for this vehicle.</p>
              <Button className="mt-4 bg-orange-500 hover:bg-orange-600" onClick={() => setShowAddDialog(true)}>Log First Repair</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="owner-parts-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Part Name</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>OEM Number</TableHead>
                    <TableHead>Mileage</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Verification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repairLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`part-row-${log.id}`}>
                      <TableCell className="font-medium">{log.part_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={log.action_type === 'Replaced' ? 'text-green-600 border-green-200 bg-green-50' : 'text-blue-600 border-blue-200 bg-blue-50'}>
                          {log.action_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.part_oem ? (
                          <button
                            onClick={() => copyHash(log.part_oem!)}
                            className="font-mono text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded flex items-center gap-1 hover:bg-purple-100"
                          >
                            {log.part_oem}
                            {copiedHash === log.part_oem ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{log.mileage?.toLocaleString()} km</TableCell>
                      <TableCell className="text-sm">{new Date(log.timestamp).toLocaleDateString()}</TableCell>
                      <TableCell className="text-sm">
                        {log.verification_status ? (
                          <Badge variant="outline" className="text-[10px]">{log.verification_status}</Badge>
                        ) : (
                          <span className="text-xs text-gray-400">unreviewed</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Why PartSentry */}
      <Card className="border-0 card-shadow bg-gradient-to-br from-purple-50 to-blue-50">
        <CardContent className="p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Shield className="w-5 h-5 text-purple-500" /> Why PartSentry Matters</h3>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            {[
              { icon: FileText, title: 'Proof of Maintenance', desc: 'Complete service history increases resale value' },
              { icon: Shield, title: 'Fraud Prevention', desc: 'Detect fake repairs and concealed accidents' },
              { icon: Search, title: 'Theft Tracking', desc: 'Track stolen parts and validate ownership' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-2">
                <item.icon className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Log New Repair Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-orange-500" /> Log New Repair to Blockchain</DialogTitle>
            <DialogDescription>This repair event will be permanently recorded on the PartSentry ledger.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Vehicle VIN</label>
              <Input value={repairForm.vin} onChange={e => setRepairForm(f => ({ ...f, vin: e.target.value }))} className="font-mono" placeholder="17-char VIN" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Part Name *</label>
                <Input value={repairForm.partName} onChange={e => setRepairForm(f => ({ ...f, partName: e.target.value }))} placeholder="e.g. Brake Pads" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Action Type *</label>
                <Select value={repairForm.actionType} onValueChange={v => setRepairForm(f => ({ ...f, actionType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Mileage (km)</label>
                <Input type="number" value={repairForm.mileage} onChange={e => setRepairForm(f => ({ ...f, mileage: e.target.value }))} placeholder="e.g. 54000" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Part OEM Number</label>
                <Input value={repairForm.partOem} onChange={e => setRepairForm(f => ({ ...f, partOem: e.target.value }))} placeholder="e.g. 04465-0K040" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <textarea
                value={repairForm.description}
                onChange={e => setRepairForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Describe the repair performed..."
                className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400 border-gray-200"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddDialog(false)} disabled={submitting}>Cancel</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={handleAddRepair} disabled={submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Recording...</> : 'Log to Blockchain'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
