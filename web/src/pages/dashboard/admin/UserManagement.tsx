import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Users, Shield, Wrench, Building2, Car, MoreHorizontal, Ban, UserCog } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { User } from '@/types'



const roleIcons: Record<string, typeof Users> = { Owner: Car, Dealer: Building2, Mechanic: Wrench, Insurance: Shield }

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

export default function UserManagement() {
  const navigate = useNavigate()
  const { fetchUsers, suspendUser } = useCarUpApi()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'Owner' })
  const [isAdding, setIsAdding] = useState(false)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await fetchUsers()
      setUsers(data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [fetchUsers])

  const handleSuspend = async (id: string) => {
    try {
      await suspendUser(id)
      toast.success('User suspended successfully')
      loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to suspend user')
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAdding(true)
    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to register user')
      }
      toast.success('User added successfully')
      setIsAddModalOpen(false)
      setNewUser({ name: '', email: '', password: '', role: 'Owner' })
      loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error adding user')
    } finally {
      setIsAdding(false)
    }
  }

  const filtered = users.filter(u => !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-gray-500">Manage platform users and their permissions</p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setIsAddModalOpen(true)}>Add User</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-0 card-shadow">
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : filtered.length > 0 ? (
          filtered.map((user) => {
            const RoleIcon = roleIcons[user.role] || Users
            return (
              <Card key={user.id} className="border-0 card-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <RoleIcon className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{user.name}</h3>
                          <Badge variant="outline" className="text-[10px]">{user.role}</Badge>
                        </div>
                        <Badge className={user.status === 'active' ? 'bg-green-500' : 'bg-red-500'}>{user.status}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        <span>{user.email}</span>
                        <span>Joined: {user.created_at || user.joined ? new Date(user.created_at || user.joined || '').toLocaleDateString() : 'N/A'}</span>
                        <span>ID: {user.id}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* O2/P3 — the person-centered compliance workspace (identity, authority,
                            ownership, dealer state as SEPARATE facts). */}
                        <DropdownMenuItem className="cursor-pointer" data-testid={`open-people-review-${user.id}`} onClick={() => navigate(`/admin/people/${user.id}/review`)}>
                          <UserCog className="w-4 h-4 mr-2" />
                          Open People &amp; Compliance Review
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600 cursor-pointer" onClick={() => handleSuspend(user.id)}>
                          <Ban className="w-4 h-4 mr-2" />
                          Suspend User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            )
          })
        ) : (
          <div className="text-center py-8 text-gray-500">No users found.</div>
        )}
      </div>

      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={newUser.name} onChange={e => setNewUser(prev => ({ ...prev, name: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" value={newUser.email} onChange={e => setNewUser(prev => ({ ...prev, email: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={newUser.password} onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={newUser.role} onValueChange={val => setNewUser(prev => ({ ...prev, role: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Owner">Owner</SelectItem>
                  <SelectItem value="Dealer">Dealer</SelectItem>
                  <SelectItem value="Mechanic">Mechanic</SelectItem>
                  <SelectItem value="Insurance">Insurance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isAdding} className="bg-orange-500 hover:bg-orange-600">
                {isAdding ? 'Adding...' : 'Add User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}