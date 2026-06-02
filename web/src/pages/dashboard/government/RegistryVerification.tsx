import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Eye } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import type { RegistryVerification } from '@/types'

export default function RegistryVerification() {
  const { fetchRegistryVerifications, updateRegistryVerification } = useCarUpApi()
  const [verifications, setVerifications] = useState<RegistryVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedVerification, setSelectedVerification] = useState<RegistryVerification | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchRegistryVerifications()
      if (Array.isArray(data)) {
        const formatted = data.map(v => ({
          id: v.id,
          vin: v.vin,
          make: v.vehicles?.make || 'Unknown',
          model: v.vehicles?.model || 'Unknown',
          registration: 'TBA',
          owner: 'Unknown Owner',
          type: 'New Registration',
          status: v.status.toLowerCase() as 'pending' | 'verified' | 'rejected' | 'approved',
          date: new Date(v.created_at).toLocaleDateString(),
          created_at: v.created_at
        }))
        setVerifications(formatted)
      } else {
        setVerifications([])
      }
    } catch (err) {
      toast.error('Failed to load registry verifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [fetchRegistryVerifications])

  const handleUpdateStatus = async (id: string, status: string) => {
    setActionLoading(id)
    try {
      await updateRegistryVerification(id, status, 'Updated by ZIMRA OS')
      toast.success(`Verification ${status} successfully`)
      await load()
    } catch (err) {
      toast.error(`Failed to ${status} verification`)
    } finally {
      setActionLoading(null)
      setSelectedVerification(null)
    }
  }

  const filtered = verifications.filter(v =>
    !search || 
    (v.vin && v.vin.toLowerCase().includes(search.toLowerCase())) || 
    (v.registration && v.registration.toLowerCase().includes(search.toLowerCase())) || 
    (v.owner && v.owner.toLowerCase().includes(search.toLowerCase())) ||
    (v.make && v.make.toLowerCase().includes(search.toLowerCase())) ||
    (v.model && v.model.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Registry Verification</h1>
        <p className="text-gray-500">Verify and manage vehicle registrations</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search by VIN, registration, or owner..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
          data-testid="registry-search-input"
          aria-label="Search by VIN, registration, or owner"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-shadow">
        <table className="w-full text-left border-collapse" data-testid="registry-table">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="p-4">Vehicle</th>
              <th className="p-4">Registration</th>
              <th className="p-4">VIN Number</th>
              <th className="p-4">Owner Name</th>
              <th className="p-4">Verification Type</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 text-sm">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <tr key={i}>
                  <td className="p-4"><Skeleton className="h-5 w-32" /></td>
                  <td className="p-4"><Skeleton className="h-5 w-20" /></td>
                  <td className="p-4"><Skeleton className="h-5 w-40" /></td>
                  <td className="p-4"><Skeleton className="h-5 w-28" /></td>
                  <td className="p-4"><Skeleton className="h-5 w-24" /></td>
                  <td className="p-4"><Skeleton className="h-5 w-16" /></td>
                  <td className="p-4"><Skeleton className="h-8 w-8 ml-auto" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-500">
                  No verifications found matching your search.
                </td>
              </tr>
            ) : (
              filtered.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50/50 transition-colors" data-testid={`registry-row-${v.id}`}>
                  <td className="p-4 font-medium text-gray-900">{v.make} {v.model}</td>
                  <td className="p-4">
                    <Badge variant="outline" className="text-[10px] font-mono">{v.registration}</Badge>
                  </td>
                  <td className="p-4 font-mono text-xs text-gray-500">{v.vin}</td>
                  <td className="p-4 text-gray-700">{v.owner}</td>
                  <td className="p-4 text-gray-500">{v.type}</td>
                  <td className="p-4">
                    <Badge className={v.status === 'verified' ? 'bg-green-500 text-white' : v.status === 'pending' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white'}>
                      {v.status}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedVerification(v)}
                      data-testid="open-registry-verification-button"
                      aria-label="View Verification Details"
                    >
                      <Eye className="w-4 h-4 text-gray-500 hover:text-gray-900" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selectedVerification} onOpenChange={(open) => !open && setSelectedVerification(null)}>
        <DialogContent className="sm:max-w-md" data-testid="registry-verification-dialog">
          <DialogHeader>
            <DialogTitle>Verification Lineage</DialogTitle>
            <DialogDescription>Full history for VIN: {selectedVerification?.vin}</DialogDescription>
          </DialogHeader>
          {selectedVerification && (
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 mb-1">Vehicle</p>
                  <p className="font-medium">{selectedVerification.make} {selectedVerification.model}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">Registration</p>
                  <p className="font-medium">{selectedVerification.registration}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">Owner</p>
                  <p className="font-medium">{selectedVerification.owner}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">Status</p>
                  <Badge className={selectedVerification.status === 'verified' ? 'bg-green-500' : selectedVerification.status === 'pending' ? 'bg-amber-500' : 'bg-blue-500'}>{selectedVerification.status}</Badge>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4 space-y-4">
                <h4 className="font-medium">Timeline</h4>
                <div className="flex gap-3 text-sm items-start">
                  <div className="mt-1 w-2 h-2 rounded-full bg-blue-500 shrink-0"></div>
                  <div>
                    <p className="font-medium">{selectedVerification.type} Requested</p>
                    <p className="text-xs text-gray-500">{selectedVerification.date}</p>
                  </div>
                </div>
                {selectedVerification.status === 'verified' && (
                  <div className="flex gap-3 text-sm items-start">
                    <div className="mt-1 w-2 h-2 rounded-full bg-green-500 shrink-0"></div>
                    <div>
                      <p className="font-medium">Verification Approved</p>
                      <p className="text-xs text-gray-500">{selectedVerification.date}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-between mt-6">
            {selectedVerification?.status === 'pending' ? (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="border-red-200 text-red-600 hover:bg-red-50"
                  disabled={actionLoading === selectedVerification.id}
                  onClick={() => handleUpdateStatus(selectedVerification.id, 'Rejected')}
                  data-testid="reject-registration-button"
                >
                  Reject
                </Button>
                <Button 
                  className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={actionLoading === selectedVerification.id}
                  onClick={() => handleUpdateStatus(selectedVerification.id, 'Approved')}
                  data-testid="approve-registration-button"
                >
                  {actionLoading === selectedVerification.id ? 'Processing...' : 'Approve Registration'}
                </Button>
              </div>
            ) : <div />}
            <Button variant="outline" onClick={() => setSelectedVerification(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}