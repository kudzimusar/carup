import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { FileText, Search, Eye, CheckCircle, XCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'

export default function Claims() {
  const { fetchClaims, updateClaimStatus } = useCarUpApi()
  const [claims, setClaims] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    loadClaims()
  }, [])

  const loadClaims = async () => {
    try {
      setLoading(true)
      const data = await fetchClaims()
      setClaims(data || [])
    } catch (error) {
      toast.error('Failed to load claims')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await updateClaimStatus(id, status)
      toast.success(`Claim ${status} successfully`)
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    } catch (error) {
      toast.error('Failed to update claim status')
    }
  }

  const filtered = claims.filter(c =>
    (!search || c.policyholder?.toLowerCase().includes(search.toLowerCase()) || c.id?.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === 'all' || c.status === statusFilter)
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Claims Management</h1>
          <p className="text-gray-500">Process and track insurance claims</p>
        </div>
        <div className="flex gap-2">
          {['all', 'pending', 'under-review', 'approved', 'rejected'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)} className={statusFilter === s ? 'bg-orange-500 hover:bg-orange-600' : ''}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search claims..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-4 flex gap-4">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="w-20 h-8" />
              </CardContent>
            </Card>
          ))
        ) : (
          filtered.map((claim) => (
            <Card key={claim.id} className="border-0 card-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{claim.id}</h3>
                        <span className="text-sm text-gray-500">{claim.policyholder}</span>
                      </div>
                      <span className="font-medium">${claim.amount?.toLocaleString() ?? 0}</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">{claim.vehicle} • {claim.type}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Policy: {claim.policy}</span>
                      <span>Date: {claim.date || new Date().toLocaleDateString()}</span>
                      <span>Assigned: {claim.assigned || 'Unassigned'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={claim.status === 'approved' ? 'bg-green-500' : claim.status === 'rejected' ? 'bg-red-500' : claim.status === 'under-review' ? 'bg-amber-500' : 'bg-blue-500'}>
                      {claim.status}
                    </Badge>
                    <Button variant="ghost" size="icon" title="View Details"><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title="Approve Claim" className="text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => handleUpdateStatus(claim.id, 'approved')}><CheckCircle className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title="Reject Claim" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleUpdateStatus(claim.id, 'rejected')}><XCircle className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-10 text-gray-500">
            No claims found.
          </div>
        )}
      </div>
    </div>
  )
}