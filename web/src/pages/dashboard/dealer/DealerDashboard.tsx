import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Car, Users, TrendingUp, DollarSign, ArrowRight,
  MapPin, BarChart3, Settings, Loader2
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import type { Vehicle } from '@/types'
import DealerIntelligence from '@/components/intelligence/DealerIntelligence'


export default function DealerDashboard() {
  const { fetchDealerInventory, loading } = useCarUpApi()

  // Branch switcher state
  const [selectedBranch, setSelectedBranch] = useState('Harare')
  const [liveInventory, setLiveInventory] = useState<Vehicle[]>([])
  const [inventoryState, setInventoryState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    // Live inventory only. Falling back to mock vehicles made an empty or failing read look like real
    // stock, and an error is not an inventory — an empty list is the honest result in both cases.
    // TENANT-SCOPED inventory. This previously read the PUBLIC platform-wide
    // vehicle list, so "Total Inventory" counted every published vehicle on CarUp
    // and "branch stock" filtered other dealers' cars by location. A failed read
    // is reported rather than rendered as an empty lot.
    fetchDealerInventory()
      .then(data => { setLiveInventory(Array.isArray(data) ? data : []); setInventoryState('ready') })
      .catch(() => { setLiveInventory([]); setInventoryState('failed') })
  }, [fetchDealerInventory])

  // A vehicle with no recorded location is NOT in Harare — an unlocated vehicle is unlocated, so it is
  // no longer filed under the default branch.
  const currentBranchStock = liveInventory.filter(v => v.location === selectedBranch).slice(0, 5)

  interface BranchPermissions {
    pricing: Record<string, boolean>;
    escrow: Record<string, boolean>;
    listings: Record<string, boolean>;
    [key: string]: Record<string, boolean>;
  }

  // Permissions state
  const [permissions, setPermissions] = useState<BranchPermissions>({
    pricing: { Owner: true, Admin: true, Staff: false },
    escrow: { Owner: true, Admin: false, Staff: false },
    listings: { Owner: true, Admin: true, Staff: true }
  })

  const togglePermission = (scope: string, role: string) => {
    setPermissions(prev => ({
      ...prev,
      [scope]: {
        ...prev[scope],
        [role]: !prev[scope][role]
      }
    }))
    toast.success(`Permission updated for ${role}.`)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dealer Dashboard</h1>
          <p className="text-gray-500">Dealer workspace</p>
        </div>
        
        {/* Branch Inventory Selector */}
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border text-xs text-gray-600 shadow-sm">
          <MapPin className="w-4 h-4 text-orange-500" />
          <span>Branch Location:</span>
          <select 
            value={selectedBranch} 
            onChange={(e) => {
              setSelectedBranch(e.target.value);
              toast.success(`Switched active branch to ${e.target.value}.`);
            }}
            className="border-none bg-transparent p-0 font-bold focus:ring-0 text-gray-800 cursor-pointer outline-none"
          >
            <option value="Harare">Harare Central</option>
            <option value="Bulawayo">Bulawayo Showroom</option>
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          // Only inventory is a real count. Leads / monthly sales / revenue had no data source and were
          // read from a fabricated `dashboardStats.dealer` block; there is no CRM or sales read model
          // behind this dashboard, so they say "Not available" rather than invent business performance.
          { label: 'Total Inventory', value: inventoryState === 'ready' ? liveInventory.length : 'Not available', icon: Car, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Leads', value: 'Not available', icon: Users, color: 'text-orange-500', bg: 'bg-orange-50' },
          { label: 'Monthly Sales', value: 'Not available', icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50' },
          { label: 'Revenue (USD)', value: 'Not available', icon: DollarSign, color: 'text-purple-500', bg: 'bg-purple-50' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 card-shadow hover-scale transition-transform">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Real marketplace inquiries on this dealer's listings (ownership-scoped backend). */}
          <SellerInquiriesCard />

          {/* Active Branch Stock */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                Branch Stock List ({selectedBranch})
                {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </CardTitle>
              <Badge className="bg-orange-500 text-white font-semibold">Live</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentBranchStock.map((vehicle, idx) => (
                <div key={idx} className="flex justify-between items-center p-3.5 bg-gray-50 hover:bg-gray-100/50 rounded-xl transition-all border border-gray-100 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                      <Car className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{vehicle.make} {vehicle.model}</p>
                      <p className="text-[10px] text-gray-500">VIN: {vehicle.vin} • Status: <span className={vehicle.status === 'Sold' ? 'text-red-500 font-bold' : 'text-green-500'}>{vehicle.status}</span></p>
                    </div>
                  </div>
                  <div className="text-right">
                    {/* Price shows only with its recorded currency — no hardcoded USD. The blanket
                        "ZIMRA Cleared" badge is removed: it was stamped on every row regardless of
                        whether that vehicle had any customs clearance evidence at all. */}
                    <p className="font-bold text-orange-600 text-sm">
                      {Number.isFinite(vehicle.price as number) && vehicle.currency
                        ? `${vehicle.currency} ${(vehicle.price as number).toLocaleString()}`
                        : 'Price not recorded'}
                    </p>
                  </div>
                </div>
              ))}
              {currentBranchStock.length === 0 && !loading && (
                <div className="text-center py-6 text-gray-500">No inventory found for {selectedBranch}.</div>
              )}
            </CardContent>
          </Card>

          {/* Team Permissions Matrix */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Team Permissions Matrix</CardTitle>
              <Settings className="w-4 h-4 text-gray-400" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase border-b">
                      <th className="px-6 py-3">Permission Scope</th>
                      <th className="px-6 py-3 text-center">Owner (L2)</th>
                      <th className="px-6 py-3 text-center">Admin (L3)</th>
                      <th className="px-6 py-3 text-center">Sales (L4)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {[
                      { scope: 'pricing', label: 'Modify Stock Pricing' },
                      { scope: 'escrow', label: 'Trigger Escrow Release' },
                      { scope: 'listings', label: 'Create New Listings' }
                    ].map((row) => (
                      <tr key={row.scope} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4 font-medium text-gray-800">{row.label}</td>
                        {['Owner', 'Admin', 'Staff'].map((role) => (
                          <td key={role} className="px-6 py-4 text-center">
                            <input
                              type="checkbox"
                              checked={permissions[row.scope][role]}
                              onChange={() => togglePermission(row.scope, role)}
                              className="rounded text-orange-500 focus:ring-orange-400 cursor-pointer h-4.5 w-4.5"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* The "Sales Performance" chart plotted a static Jan–May series
              (8/10/12/9/14) identical for every dealer. CarUp holds no
              authoritative record of a dealer's completed sales, so there is
              nothing to plot — governed marketplace performance is shown instead,
              and the absence of sales data is stated rather than drawn. */}
          <DealerIntelligence windowDays={30} />

          {/* Inventory aging was three fixed Progress bars — 60% / 30% / 10% —
              hardcoded for every dealer and labelled "(Harare)" whichever branch
              was selected. `vehicles` carries no governed publication date (only
              the row-insert timestamp), so days-on-market cannot be computed
              without inventing it. The absence is named instead. */}
          <Card className="border-0 card-shadow bg-white">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Inventory aging</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600" data-testid="dealer-inventory-aging-unavailable">
                Not available. CarUp does not record a governed publication date for a listing,
                so days on market cannot be measured. This is not zero.
              </p>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="border-0 card-shadow">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Manage Inventory', href: '/dealer/inventory', icon: Car },
                { label: 'View Leads', href: '/dealer/leads', icon: Users },
                { label: 'Sales Analytics', href: '/dealer/analytics', icon: BarChart3 },
              ].map((link) => (
                <Link key={link.label} to={link.href} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <link.icon className="w-4 h-4 text-orange-500" />
                  <span className="flex-1 font-semibold">{link.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}