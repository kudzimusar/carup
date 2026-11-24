import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Wrench, Search, Plus, Calendar, FileText, Loader2, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { UNIFIED_PRIMARY_ACTION } from '@/components/workbench/institutionalRecords'

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

export default function ServiceLogs() {
  const { addRepairLog, fetchRepairHistory, loading } = useCarUpApi()
  const [logs, setLogs] = useState<RepairLogRow[]>([])
  const [vinQuery, setVinQuery] = useState('')
  const [loadedVin, setLoadedVin] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    vin: '',
    partName: '',
    partOem: '',
    actionType: 'Replaced',
    description: '',
    mileage: 0
  })

  // RX06-LR06 U06-S1 (unified only): a failed lookup never leaves the previous vehicle's logs on screen and is not
  // shown as an empty history.
  const unified = isUnifiedUiEnabled()
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null)
  const [loadRefused, setLoadRefused] = useState(false)

  const loadHistory = async (vin: string) => {
    const trimmed = vin.trim()
    if (!trimmed) {
      toast.error('Enter a vehicle VIN to load its service history')
      return
    }
    setHistoryLoading(true)
    try {
      const rows = await fetchRepairHistory(trimmed)
      setLogs(Array.isArray(rows) ? rows : [])
      setLoadedVin(trimmed)
      setLoadFailedFor(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load service history')
      if (unified) {
        setLogs([])
        setLoadedVin('')
        setLoadFailedFor(trimmed)
        setLoadRefused((err as { status?: unknown } | null)?.status === 403)
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await addRepairLog(
        formData.vin,
        formData.partName,
        formData.partOem,
        formData.actionType,
        formData.description,
        Number(formData.mileage)
      )
      if (res?.id) {
        toast.success(`Service log #${res.id} recorded securely to PartSentry`)
        setIsModalOpen(false)
        // Reload the real history for the VIN we just wrote to.
        setVinQuery(formData.vin)
        await loadHistory(formData.vin)
        setFormData({ vin: '', partName: '', partOem: '', actionType: 'Replaced', description: '', mileage: 0 })
      } else {
        toast.error('The server did not confirm the log was recorded')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add log')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className={unified ? 'flex flex-wrap items-start justify-between gap-3' : 'flex items-center justify-between'}>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Service Logs
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Complete service history records</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className={unified ? `${UNIFIED_PRIMARY_ACTION} min-h-11 sm:min-h-9 gap-1` : 'bg-orange-500 hover:bg-orange-600 gap-1 text-white'}><Plus className="w-4 h-4" /> Add Log</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-orange-500" />
                Record Service Log (PartSentry)
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-md flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{unified ? 'Logs submitted here are permanently recorded on the PartSentry ledger for this vehicle. This cannot be undone.' : 'Logs submitted here are cryptographically signed and permanently recorded on the PartSentry audit ledger. This cannot be undone.'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vehicle VIN</Label>
                  <Input required value={formData.vin} onChange={e => setFormData({...formData, vin: e.target.value})} placeholder="e.g. JTD12345..." />
                </div>
                <div className="space-y-2">
                  <Label>Mileage (km)</Label>
                  <Input required type="number" min="0" value={formData.mileage} onChange={e => setFormData({...formData, mileage: Number(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Part Name</Label>
                  <Input required value={formData.partName} onChange={e => setFormData({...formData, partName: e.target.value})} placeholder="e.g. Brake Pads" />
                </div>
                <div className="space-y-2">
                  <Label>OEM Part Number</Label>
                  <Input required value={formData.partOem} onChange={e => setFormData({...formData, partOem: e.target.value})} placeholder="e.g. BP-TYT-001" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <select
                  className="w-full flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.actionType}
                  onChange={e => setFormData({...formData, actionType: e.target.value})}
                >
                  {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Description / Notes</Label>
                <Input required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Details of the service performed" />
              </div>
              <Button type="submit" className={unified ? `w-full ${UNIFIED_PRIMARY_ACTION}` : 'w-full bg-orange-500 hover:bg-orange-600 text-white'} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Submit to PartSentry
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <form
        className={unified ? 'flex flex-wrap sm:flex-nowrap gap-2' : 'flex gap-2'}
        onSubmit={e => { e.preventDefault(); loadHistory(vinQuery) }}
      >
        <div className={unified ? 'relative flex-1 min-w-[12rem]' : 'relative flex-1'}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Enter a vehicle VIN to load its service history..."
            value={vinQuery}
            onChange={e => setVinQuery(e.target.value)}
            className={unified ? 'pl-10 min-h-11 sm:min-h-9 bg-white font-mono' : 'pl-10 bg-white font-mono'}
            {...(unified ? { 'aria-label': 'Vehicle VIN' } : {})}
          />
        </div>
        <Button type="submit" variant="outline" className={unified ? 'min-h-11 sm:min-h-9' : undefined} disabled={historyLoading}>
          {historyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load History'}
        </Button>
      </form>

      <div className="space-y-4">
        {logs.map((log) => (
          <Card key={log.id} className="border-0 card-shadow transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-lg">{log.part_name} — {log.action_type}</h3>
                    {log.part_oem && <span className="text-sm font-medium bg-gray-50 text-gray-700 px-2 py-1 rounded-md font-mono">{log.part_oem}</span>}
                  </div>
                  <p className="text-sm text-gray-600 mb-3 font-mono">{log.vin}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 bg-gray-50 p-2 rounded-md">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{new Date(log.timestamp).toLocaleDateString()}</span>
                    <span className="font-medium text-gray-800">{log.mileage?.toLocaleString()} km</span>
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Recorded on PartSentry</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {logs.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            {unified && loadFailedFor ? (
              <div data-testid="service-logs-read-failed" role="status">
                <h3 className="text-lg font-medium text-gray-900 mb-1">{loadRefused ? `This account cannot read the service history for ${loadFailedFor}` : `The service history for ${loadFailedFor} could not be loaded`}</h3>
                <p className="text-gray-500">{loadRefused ? 'CarUp refused this account access to that history. Nothing has changed.' : 'This is not an empty history: CarUp could not read it just now. Nothing has changed.'}</p>
                {!loadRefused && (
                  <Button type="button" variant="outline" className="mt-3 min-h-11 sm:min-h-9" onClick={() => void loadHistory(loadFailedFor)} data-testid="service-logs-retry">
                    Try again
                  </Button>
                )}
              </div>
            ) : loadedVin ? (
              <>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No service logs found for {loadedVin}</h3>
                <p className="text-gray-500">Record a new service log to add history for this vehicle.</p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No vehicle loaded</h3>
                <p className="text-gray-500">Enter a VIN above to load its real PartSentry service history.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
