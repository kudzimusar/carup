import type { ReactNode } from 'react'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EvidenceLine,
  MoneyDisplay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TrustLens,
  VehicleIdentity,
  WorkspaceShell,
} from '@carup/design-system'

const noop = () => {}

// Mirrors the owner registry projection (featureRegistry owner.* items), minus the
// registry's own "Overview" entry, which duplicates the shell's built-in Overview link.
const PERSONAL_RAIL = [
  {
    title: 'Commerce',
    items: [
      { id: 'owner.garage', label: 'My Garage', href: '/dashboard/garage', icon: 'Car' as const, planned: false },
      { id: 'owner.saved', label: 'Saved Cars', href: '/dashboard/saved', icon: 'Heart' as const, planned: false },
      { id: 'owner.intelligence', label: 'Seller Intelligence', href: '/dashboard/intelligence', icon: 'BarChart3' as const, planned: false },
      { id: 'owner.ai', label: 'Gutu AI', href: '/dashboard/ai', icon: 'MessageSquare' as const, planned: false },
    ],
  },
  {
    title: 'Evidence',
    items: [{ id: 'owner.evidence-vault', label: 'Evidence Vault', href: '/dashboard/evidence', icon: 'FileText' as const, planned: false }],
  },
  {
    title: 'Service',
    items: [{ id: 'owner.service-history', label: 'Service History', href: '/dashboard/service-history', icon: 'Wrench' as const, planned: false }],
  },
  {
    title: 'Insurance',
    items: [{ id: 'owner.insurance', label: 'Insurance', href: '/dashboard/insurance', icon: 'Shield' as const, planned: false }],
  },
]

const PanelCard = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <Card className="gap-4 py-4">
    <CardHeader className="px-4">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 px-4">{children}</CardContent>
  </Card>
)

export const PersonalVehicle = () => (
  <WorkspaceShell
    family="personal"
    identity={{ displayName: 'Tendai Moyo', roleTitle: 'Owner' }}
    currentPath="/dashboard/garage"
    breadcrumbs={[
      { label: 'My CarUp', href: '/dashboard' },
      { label: 'Garage', href: '/dashboard/garage' },
    ]}
    object={{
      title: 'Toyota Hilux 2.8 GD-6 Raider',
      reference: 'VEH-0457',
      statusLabel: 'Listed',
      statusTone: 'success',
      meta: ['Listed 03 Nov 2026'],
    }}
    primaryAction={{ label: 'Book inspection', onSelect: noop }}
    railSections={PERSONAL_RAIL}
    statusPanel={
      <PanelCard title="Status and evidence" description="What buyers see on the listing">
        <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
        <div className="space-y-1.5">
          <EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />
          <EvidenceLine actor="Toyota Zimbabwe, Msasa" source="Service invoice" at="2026-09-12" />
          <EvidenceLine actor="Seller" source="Logbook scan" at="2026-11-03" status="awaiting review" />
        </div>
      </PanelCard>
    }
    onSignOut={noop}
  >
    <div className="space-y-5">
      <VehicleIdentity
        title="Toyota Hilux 2.8 GD-6 Raider"
        vin="AHTGB3CD005123456"
        year={2021}
        mileageKm={62400}
        location="Harare"
        variant="header"
        exposure="workspace"
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        <Card>
          <CardHeader>
            <CardTitle>Listing price</CardTitle>
            <CardDescription>Your asking price against the market guide</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <MoneyDisplay amount={38500} currency="USD" source="asking" size="lg" />
            <div><MoneyDisplay amount={36200} currency="USD" source="guide" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Enquiries</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">New</dt>
              <dd className="text-right font-medium">4</dd>
              <dt className="text-muted-foreground">Awaiting reply</dt>
              <dd className="text-right font-medium">2</dd>
              <dt className="text-muted-foreground">Viewings booked</dt>
              <dd className="text-right font-medium">1</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  </WorkspaceShell>
)

const DEALER_RAIL = [
  {
    title: 'Operations',
    items: [
      { id: 'dealer-dashboard', label: 'Dashboard', href: '/dealer/dashboard', icon: 'LayoutDashboard' as const, planned: false },
      { id: 'dealer-inventory', label: 'Inventory', href: '/dealer/inventory', icon: 'Car' as const, planned: true },
      { id: 'dealer-leads', label: 'Leads', href: '/dealer/leads', icon: 'MessageSquare' as const, planned: true },
    ],
  },
  {
    title: 'Growth',
    items: [
      { id: 'dealer-promotions', label: 'Promotions', href: '/dealer/promotions', icon: 'Tag' as const, planned: true },
      { id: 'dealer-analytics', label: 'Analytics', href: '/dealer/analytics', icon: 'BarChart3' as const, planned: true },
      { id: 'dealer-evidence', label: 'Evidence', href: '/dealer/evidence', icon: 'FileSearch' as const, planned: true },
    ],
  },
]

const STOCK = [
  { title: 'Toyota Hilux 2.8 GD-6 Raider', year: 2021, days: 12, price: 38500, lens: { state: 'evaluated' as const, sourceCount: 3, freshness: '12 Nov 2026' } },
  { title: 'Mazda CX-5 2.0 Dynamic', year: 2019, days: 34, price: 24800, lens: { state: 'stale' as const, sourceCount: 3, freshness: '14 Mar 2026' } },
  { title: 'Nissan NP200 1.6 8V', year: 2017, days: 5, price: 6750, lens: { state: 'not-evaluated' as const, sourceCount: 0, freshness: '11 Nov 2026' } },
  { title: 'Toyota Fortuner 2.8 GD-6 4x4', year: 2020, days: 21, price: 41900, lens: { state: 'insufficient-data' as const, sourceCount: 1, freshness: '08 Nov 2026' } },
]

export const DealerDashboard = () => (
  <WorkspaceShell
    family="dealer"
    identity={{ displayName: 'Farai Chikwanha', roleTitle: 'Dealer OS', tenantLabel: 'Croco Motors Harare' }}
    currentPath="/dealer/dashboard"
    breadcrumbs={[{ label: 'Dealer OS', href: '/dealer/dashboard' }, { label: 'Dashboard' }]}
    object={{
      title: 'Croco Motors Harare',
      reference: 'tenant 4f2a91c0',
      statusLabel: 'Operating',
      statusTone: 'success',
      meta: ['org 7d31e5b2'],
    }}
    railSections={DEALER_RAIL}
    overviewHref="/dealer/dashboard"
    statusPanel={
      <PanelCard title="Today" description="Harare showroom · Samora Machel Ave">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Enquiries to answer</dt>
          <dd className="text-right font-medium">3</dd>
          <dt className="text-muted-foreground">Viewings booked</dt>
          <dd className="text-right font-medium">2</dd>
          <dt className="text-muted-foreground">Need evidence</dt>
          <dd className="text-right font-medium">2</dd>
        </dl>
        <EvidenceLine actor="Stock audit" source="Monthly reconciliation" at="2026-11-01" />
      </PanelCard>
    }
    onSignOut={noop}
  >
    <Card>
      <CardHeader>
        <CardTitle>Stock on the marketplace</CardTitle>
        <CardDescription>4 live listings</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STOCK.map((s) => (
              <TableRow key={s.title}>
                <TableCell style={{ minWidth: 340 }}>
                  <div className="font-medium">{s.title}</div>
                  <div className="text-[12px] text-carup-text-3">{s.year} · listed {s.days} days</div>
                  <div className="mt-1.5"><TrustLens {...s.lens} /></div>
                </TableCell>
                <TableCell className="text-right align-top"><MoneyDisplay amount={s.price} currency="USD" source="asking" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </WorkspaceShell>
)

export const SavedVehicles = () => (
  <WorkspaceShell
    family="personal"
    identity={{ displayName: 'Rudo Ncube', roleTitle: 'Owner' }}
    currentPath="/dashboard/saved"
    breadcrumbs={[{ label: 'My CarUp', href: '/dashboard' }, { label: 'Saved Cars' }]}
    object={{ title: 'Saved Cars', reference: 'owner.saved', statusLabel: 'Signed in', statusTone: 'neutral' }}
    railSections={PERSONAL_RAIL}
    statusPanel={
      <PanelCard title="Price alerts" description="Changes since your last visit">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Price dropped</Badge>
          <span className="text-[13px] text-carup-text-2">Mazda CX-5 2.0 Dynamic</span>
        </div>
        <MoneyDisplay amount={24800} currency="USD" source="asking" size="lg" />
      </PanelCard>
    }
    onSignOut={noop}
  >
    <Card>
      <CardHeader>
        <CardTitle>Saved vehicles</CardTitle>
        <CardDescription>3 vehicles · you'll be alerted when a price changes</CardDescription>
      </CardHeader>
      <CardContent>
        <VehicleIdentity title="Honda Fit 1.3 Hybrid" year={2014} mileageKm={118200} location="Bulawayo" variant="row" />
        <VehicleIdentity title="Mazda CX-5 2.0 Dynamic" year={2019} mileageKm={71250} location="Harare" variant="row" />
        <VehicleIdentity title="Nissan NP200 1.6 8V" year={2017} mileageKm={143900} location="Mutare" variant="row" />
      </CardContent>
    </Card>
  </WorkspaceShell>
)
