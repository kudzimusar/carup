import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes, History, Loader2, PackagePlus, ShieldCheck, FileText } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type {
  DiasporaStockItem,
  DiasporaStockLedgerEntry,
  DiasporaSupplyDocument,
} from '@/types'

const allowedSellerRoles = new Set(['dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])

const LEDGER_ACTIONS = ['ADD', 'REMOVE', 'RESERVE', 'RELEASE_RESERVATION', 'DAMAGE', 'RETURN', 'TRANSFER']

function genKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `mv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function DiasporaStockManager() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [items, setItems] = useState<DiasporaStockItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<DiasporaStockItem | null>(null)
  const [ledger, setLedger] = useState<DiasporaStockLedgerEntry[]>([])
  const [docs, setDocs] = useState<DiasporaSupplyDocument[]>([])
  const [docError, setDocError] = useState('')

  // create stock form
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // ledger action form
  const [action, setAction] = useState('ADD')
  const [actionQty, setActionQty] = useState('')
  const [actionError, setActionError] = useState('')
  const [movementLoading, setMovementLoading] = useState(false)
  const movingRef = useRef(false)

  // publication controls
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
  const [publishError, setPublishError] = useState('')

  // supply document form
  const [docNumber, setDocNumber] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docOrigin, setDocOrigin] = useState('')
  const [docSubmitting, setDocSubmitting] = useState(false)

  const canView = useMemo(
    () => isAuthenticated && allowedSellerRoles.has((user?.role || '').toLowerCase()),
    [isAuthenticated, user?.role],
  )

  const loadList = useCallback(async () => {
    if (!canView) return
    setListLoading(true)
    setListError('')
    try {
      const data = await api.fetchDiasporaStockItems()
      setItems(data)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Unable to load stock')
    } finally {
      setListLoading(false)
    }
  }, [api, canView])

  const loadDocs = useCallback(async () => {
    if (!canView) return
    try {
      setDocs(await api.fetchDiasporaSupplyDocuments())
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Unable to load supply documents')
    }
  }, [api, canView])

  const loadLedger = useCallback(async (id: string) => {
    try {
      setLedger(await api.fetchDiasporaStockLedger(id))
    } catch {
      setLedger([])
    }
  }, [api])

  useEffect(() => {
    if (authLoading || !canView) return
    void loadList()
    void loadDocs()
  }, [authLoading, canView, loadList, loadDocs])

  const selectItem = async (item: DiasporaStockItem) => {
    setSelected(item)
    setActionError('')
    setPublishMessage('')
    setPublishError('')
    await loadLedger(item.id)
  }

  const handlePublishToggle = async () => {
    if (publishBusy || !selected) return
    setPublishMessage('')
    setPublishError('')
    setPublishBusy(true)
    try {
      const isPublished = (selected.publication_status || '').toUpperCase() === 'PUBLISHED'
      const updated = isPublished
        ? await api.unpublishDiasporaStockItem(selected.id)
        : await api.publishDiasporaStockItem(selected.id)
      setSelected(updated)
      setPublishMessage(isPublished ? 'Stock item unpublished.' : 'Stock item published.')
      await loadList()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publication change rejected')
    } finally {
      setPublishBusy(false)
    }
  }

  const handleCreate = async () => {
    if (creating) return
    setCreateError('')
    if (!newName.trim()) {
      setCreateError('Part name is required')
      return
    }
    setCreating(true)
    try {
      const created = await api.createDiasporaStockItem({
        part_name: newName.trim(),
        initial_quantity: newQty ? Number(newQty) : 0,
      })
      setNewName('')
      setNewQty('')
      await loadList()
      await selectItem(created)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create stock item')
    } finally {
      setCreating(false)
    }
  }

  const handleMovement = async () => {
    if (movingRef.current || !selected) return
    setActionError('')
    const qty = Number(actionQty)
    if (!(qty > 0)) {
      setActionError('Enter a positive quantity')
      return
    }
    movingRef.current = true
    setMovementLoading(true)
    try {
      const result = await api.appendDiasporaStockMovement(selected.id, {
        action,
        quantity: qty,
        idempotencyKey: genKey(),
        source: 'ui',
      })
      setSelected(result.stockItem)
      setActionQty('')
      await loadList()
      await loadLedger(selected.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Movement rejected')
    } finally {
      movingRef.current = false
      setMovementLoading(false)
    }
  }

  const handleCreateDoc = async () => {
    if (docSubmitting) return
    setDocError('')
    if (!docNumber.trim() || !docTitle.trim()) {
      setDocError('Document number and title are required')
      return
    }
    setDocSubmitting(true)
    try {
      await api.createDiasporaSupplyDocument({
        document_number: docNumber.trim(),
        title: docTitle.trim(),
        origin_country: docOrigin.trim() || undefined,
      })
      setDocNumber('')
      setDocTitle('')
      setDocOrigin('')
      await loadDocs()
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Unable to create supply document')
    } finally {
      setDocSubmitting(false)
    }
  }

  const handlePublishDoc = async (doc: DiasporaSupplyDocument) => {
    setDocError('')
    try {
      await api.publishDiasporaSupplyDocument(doc.id)
      await loadDocs()
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Publish blocked')
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-orange-600">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-stock-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>Stock management requires a seller or reviewer role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const balances = selected?.balances || {
    onHand: Number(selected?.quantity_on_hand || 0),
    reserved: Number(selected?.quantity_reserved || 0),
    available: Number(selected?.quantity_on_hand || 0) - Number(selected?.quantity_reserved || 0),
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-stock-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950">
            <Boxes className="h-6 w-6 text-orange-600" /> Stock manager
          </h1>
          <p className="mt-1 text-sm text-gray-500">Ledger-backed stock. Quantities change only through movements — never direct edits.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/diaspora/imports">Import orders</Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Create + list */}
        <div className="space-y-4">
          <section className="rounded-md border border-gray-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950"><PackagePlus className="h-5 w-5 text-orange-600" /> New draft stock</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input placeholder="Part name" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="diaspora-stock-create-name" />
              <Input type="number" min="0" placeholder="Opening quantity" value={newQty} onChange={(e) => setNewQty(e.target.value)} data-testid="diaspora-stock-create-qty" />
            </div>
            {createError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-stock-create-error">{createError}</p>}
            <Button className="mt-3" onClick={handleCreate} disabled={creating} data-testid="diaspora-stock-create-submit">
              {creating ? 'Creating…' : 'Create stock item'}
            </Button>
          </section>

          <section className="rounded-md border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-950">Stock items</h2>
            {listLoading && (
              <p className="mt-3 flex items-center gap-2 text-sm text-orange-700" data-testid="diaspora-stock-loading">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading stock…
              </p>
            )}
            {listError && (
              <Alert className="mt-3 border-red-200 bg-red-50" data-testid="diaspora-stock-list-error">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            )}
            {!listLoading && !listError && items.length === 0 && (
              <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-stock-empty">No stock items yet.</p>
            )}
            {items.length > 0 && (
              <div className="mt-3 rounded-md border border-gray-200" data-testid="diaspora-stock-list">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part</TableHead>
                      <TableHead>On hand</TableHead>
                      <TableHead>Reserved</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const b = item.balances || { onHand: Number(item.quantity_on_hand || 0), reserved: Number(item.quantity_reserved || 0), available: Number(item.quantity_on_hand || 0) - Number(item.quantity_reserved || 0) }
                      return (
                        <TableRow key={item.id} data-testid="diaspora-stock-row">
                          <TableCell className="font-medium">{item.part_name}</TableCell>
                          <TableCell>{b.onHand}</TableCell>
                          <TableCell>{b.reserved}</TableCell>
                          <TableCell>{b.available}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => selectItem(item)} data-testid="diaspora-stock-select">Manage</Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>

        {/* Detail + ledger + supply docs */}
        <div className="space-y-4">
          {selected ? (
            <section className="rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-stock-detail">
              <h2 className="text-lg font-semibold text-gray-950">{selected.part_name}</h2>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="rounded-md border border-gray-200 p-3"><p className="text-xs uppercase text-gray-500">On hand</p><p className="text-2xl font-semibold" data-testid="diaspora-stock-balance-onhand">{balances.onHand}</p></div>
                <div className="rounded-md border border-gray-200 p-3"><p className="text-xs uppercase text-gray-500">Reserved</p><p className="text-2xl font-semibold" data-testid="diaspora-stock-balance-reserved">{balances.reserved}</p></div>
                <div className="rounded-md border border-gray-200 p-3"><p className="text-xs uppercase text-gray-500">Available</p><p className="text-2xl font-semibold" data-testid="diaspora-stock-balance-available">{balances.available}</p></div>
              </div>

              <div className="mt-4 rounded-md border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">Publication</p>
                  <Badge variant="outline" data-testid="diaspora-stock-publication-status">
                    {selected.publication_status || 'PRIVATE'}
                  </Badge>
                  {(selected.publication_status || '').toUpperCase() === 'PUBLISHED' ? (
                    <Button size="sm" variant="outline" onClick={handlePublishToggle} disabled={publishBusy} data-testid="diaspora-stock-unpublish">
                      {publishBusy ? 'Updating…' : 'Unpublish'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={handlePublishToggle} disabled={publishBusy} data-testid="diaspora-stock-publish">
                      {publishBusy ? 'Updating…' : 'Publish'}
                    </Button>
                  )}
                </div>
                <p aria-live="polite" className="mt-1 text-sm">
                  {publishMessage && <span className="font-medium text-green-700" data-testid="diaspora-stock-publish-result">{publishMessage}</span>}
                  {publishError && <span className="font-medium text-red-700" data-testid="diaspora-stock-publish-error">{publishError}</span>}
                </p>
              </div>

              <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3">
                <p className="text-sm font-medium text-orange-900">Ledger movement</p>
                <p className="text-xs text-orange-800">Quantities are not editable directly. Record a movement instead.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" data-testid="diaspora-stock-action-select">
                    {LEDGER_ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                  </select>
                  <Input type="number" min="0" placeholder="Qty" value={actionQty} onChange={(e) => setActionQty(e.target.value)} className="w-28" data-testid="diaspora-stock-action-qty" />
                  <Button onClick={handleMovement} disabled={movementLoading} data-testid="diaspora-stock-action-submit">
                    {movementLoading ? 'Recording…' : 'Record movement'}
                  </Button>
                </div>
                {actionError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-stock-action-error">{actionError}</p>}
              </div>

              <div className="mt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><History className="h-4 w-4" /> Ledger history</h3>
                <div className="mt-2 rounded-md border border-gray-200" data-testid="diaspora-stock-ledger">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Action</TableHead><TableHead>Δ</TableHead><TableHead>After</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500">No movements yet.</TableCell></TableRow>
                      ) : ledger.map((entry) => (
                        <TableRow key={entry.id} data-testid="diaspora-stock-ledger-row">
                          <TableCell>{entry.action_type}</TableCell>
                          <TableCell>{entry.quantity_delta}</TableCell>
                          <TableCell>{entry.quantity_after}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-md border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500" data-testid="diaspora-stock-detail-empty">
              Select a stock item to record ledger movements.
            </section>
          )}

          <section className="rounded-md border border-gray-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950"><FileText className="h-5 w-5 text-orange-600" /> Supply documents</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Input placeholder="Document #" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} data-testid="diaspora-supply-create-number" />
              <Input placeholder="Title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} data-testid="diaspora-supply-create-title" />
              <Input placeholder="Origin country" value={docOrigin} onChange={(e) => setDocOrigin(e.target.value)} data-testid="diaspora-supply-create-origin" />
            </div>
            <Button className="mt-3" variant="secondary" onClick={handleCreateDoc} disabled={docSubmitting} data-testid="diaspora-supply-create-submit">
              {docSubmitting ? 'Saving…' : 'Create draft document'}
            </Button>
            {docError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-supply-error">{docError}</p>}
            <div className="mt-3 rounded-md border border-gray-200" data-testid="diaspora-supply-list">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Number</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {docs.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="h-12 text-center text-gray-500">No supply documents yet.</TableCell></TableRow>
                  ) : docs.map((doc) => (
                    <TableRow key={doc.id} data-testid="diaspora-supply-row">
                      <TableCell className="font-medium">{doc.document_number}</TableCell>
                      <TableCell>{doc.title}</TableCell>
                      <TableCell><Badge variant="outline">{doc.status}</Badge></TableCell>
                      <TableCell>
                        {doc.status !== 'PUBLISHED' && (
                          <Button size="sm" variant="outline" onClick={() => handlePublishDoc(doc)} data-testid="diaspora-supply-publish">Publish</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
